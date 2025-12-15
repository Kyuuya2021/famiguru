import { NextResponse } from 'next/server';

import { Client } from '@line/bot-sdk';

import { createClient } from '@supabase/supabase-js';

import OpenAI from 'openai';



// 環境変数の取得

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const openaiApiKey = process.env.OPENAI_API_KEY || '';



// LINE クライアントの作成

const lineClient = new Client({

  channelAccessToken: channelAccessToken,

});



// Supabase クライアントの作成

const supabase = createClient(supabaseUrl, supabaseKey);



// OpenAI クライアントの作成

const openai = new OpenAI({

  apiKey: openaiApiKey,

});



// 時間帯を判定する関数

function getTimeOfDay(): string {

  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {

    return '朝';

  } else if (hour >= 12 && hour < 18) {

    return '昼';

  } else {

    return '夜';

  }

}



// 季節を判定する関数

function getSeason(): string {

  const month = new Date().getMonth() + 1; // 0-11 なので +1

  if (month >= 3 && month <= 5) {

    return '春';

  } else if (month >= 6 && month <= 8) {

    return '夏';

  } else if (month >= 9 && month <= 11) {

    return '秋';

  } else {

    return '冬';

  }

}



export async function GET() {

  try {

    // 1. families テーブルから全ての家族グループを取得

    const { data: families, error: familiesError } = await supabase

      .from('families')

      .select('id, line_group_id');



    if (familiesError) {

      console.error('families取得エラー:', familiesError);

      return NextResponse.json(

        { error: 'Failed to fetch families', details: familiesError.message },

        { status: 500 }

      );

    }



    if (!families || families.length === 0) {

      console.log('家族グループが見つかりません');

      return NextResponse.json({ message: 'OK', processed: 0 });

    }



    const timeOfDay = getTimeOfDay();

    const season = getSeason();

    let successCount = 0;

    let errorCount = 0;



    // 2. 各家族について処理

    for (const family of families) {

      try {

        // 3. OpenAI API (gpt-4o-mini) で話題を生成

        const prompt = `現在は${season}の${timeOfDay}です。家族の会話が盛り上がる、季節や時間帯に合った話題を1つ考えてください。質問形式でも、話題提供でも構いません。`;



        const completion = await openai.chat.completions.create({

          model: 'gpt-4o-mini',

          messages: [

            {

              role: 'system',

              content: 'あなたは家族の会話を盛り上げる話題を提供する司会者です。季節や時間帯に合わせた、ユニークで具体的な話題を1つだけ生成してください。',

            },

            {

              role: 'user',

              content: prompt,

            },

          ],

          max_tokens: 150,

          temperature: 0.8,

        });



        const topic = completion.choices[0]?.message?.content?.trim();

        if (!topic) {

          console.error(`家族ID ${family.id}: 話題生成失敗`);

          errorCount++;

          continue;

        }



        // 4. 送信先のユーザー情報を取得（会話ログの紐付け用）

        // line_group_id がある場合でも、会話ログには「誰か」のIDが必要なため取得する

        const memberInfo = await getFamilyMemberInfo(family.id);

        if (!memberInfo) {

           console.error(`家族ID ${family.id}: メンバーが見つかりません`);

           errorCount++;

           continue;

        }



        // 5. LINE送信処理

        if (family.line_group_id) {

          // グループに送信

          try {

            await lineClient.pushMessage(family.line_group_id, {

              type: 'text',

              text: topic,

            });

            console.log(`話題をグループ送信: ${topic}`);

          } catch (lineError: any) {

            console.error(`グループ送信エラー:`, lineError);

            // グループ送信失敗時、個人へのフォールバック

            try {

                await lineClient.pushMessage(memberInfo.lineUserId, {

                    type: 'text',

                    text: topic,

                });

                console.log(`個人へフォールバック送信: ${topic}`);

            } catch (fbError) {

                console.error(`フォールバック失敗:`, fbError);

                errorCount++;

                continue;

            }

          }

        } else {

          // 個人に送信

          try {

            await lineClient.pushMessage(memberInfo.lineUserId, {

              type: 'text',

              text: topic,

            });

            console.log(`話題を個人送信: ${topic}`);

          } catch (lineError: any) {

            console.error(`個人送信エラー:`, lineError);

            errorCount++;

            continue;

          }

        }



        // 6. daily_topics テーブルに保存

        await supabase

          .from('daily_topics')

          .insert({

            family_id: family.id,

            topic: topic,

            sent_to_user_id: memberInfo.profileId,

          });



        // 7. 【追加】conversations テーブルに保存（履歴表示用）

        // AIが生成したメッセージとして保存する

        const { error: convError } = await supabase

            .from('conversations')

            .insert({

                family_id: family.id,

                sender_id: memberInfo.profileId, // 紐付け用ユーザーID

                content: topic,

                is_ai_generated: true

            });

        

        if (convError) {

            console.error('会話ログ保存エラー:', convError);

        } else {

            console.log('会話ログに保存しました');

        }



        successCount++;

      } catch (error: any) {

        console.error(`家族ID ${family.id} の処理エラー:`, error);

        errorCount++;

      }

    }



    return NextResponse.json({

      message: 'OK',

      processed: families.length,

      success: successCount,

      errors: errorCount,

    });

  } catch (error: any) {

    console.error('サーバー内部エラー:', error);

    return NextResponse.json(

      {

        error: 'Internal server error',

        details: error.message,

      },

      { status: 500 }

    );

  }

}



// 家族メンバー1名の情報（LINE ID と Profile ID）を取得する関数

async function getFamilyMemberInfo(familyId: string): Promise<{ lineUserId: string, profileId: string } | null> {

  try {

    // 1. 家族メンバーを取得

    const { data: familyMembers, error: membersError } = await supabase

      .from('family_members')

      .select('profile_id')

      .eq('family_id', familyId)

      .limit(1);



    if (membersError || !familyMembers || familyMembers.length === 0) {

      return null;

    }



    const profileId = familyMembers[0].profile_id;



    // 2. プロフィール（LINE ID）を取得

    const { data: profile, error: profileError } = await supabase

      .from('profiles')

      .select('line_user_id')

      .eq('id', profileId)

      .single();



    if (profileError || !profile || !profile.line_user_id) {

      return null;

    }



    return {

        lineUserId: profile.line_user_id,

        profileId: profileId

    };

  } catch (error) {

    console.error(`メンバー情報取得エラー:`, error);

    return null;

  }

}
