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

        // 4. 生成した話題を送信
        let sentToUserId: string | null = null;

        if (family.line_group_id) {
          // line_group_id がある場合はグループに送信
          try {
            await lineClient.pushMessage(family.line_group_id, {
              type: 'text',
              text: topic,
            });
            console.log(`話題をグループに送信しました: ${topic} (family_id: ${family.id}, group_id: ${family.line_group_id})`);
          } catch (lineError: any) {
            console.error(`グループ送信エラー (family_id: ${family.id}):`, lineError);
            // グループ送信に失敗した場合、フォールバックとして個人に送信を試みる
            const fallbackUserId = await getFamilyMemberLineUserId(family.id);
            if (fallbackUserId) {
              try {
                await lineClient.pushMessage(fallbackUserId, {
                  type: 'text',
                  text: topic,
                });
                console.log(`話題を個人に送信しました（フォールバック）: ${topic} (family_id: ${family.id})`);
              } catch (fallbackError: any) {
                console.error(`フォールバック送信エラー (family_id: ${family.id}):`, fallbackError);
                errorCount++;
                continue;
              }
            } else {
              errorCount++;
              continue;
            }
          }
        } else {
          // line_group_id がない場合は、家族メンバー1名を探して送信
          const lineUserId = await getFamilyMemberLineUserId(family.id);
          if (!lineUserId) {
            console.error(`家族ID ${family.id}: 送信先のユーザーが見つかりません`);
            errorCount++;
            continue;
          }

          try {
            await lineClient.pushMessage(lineUserId, {
              type: 'text',
              text: topic,
            });
            console.log(`話題を個人に送信しました: ${topic} (family_id: ${family.id}, user_id: ${lineUserId})`);
          } catch (lineError: any) {
            console.error(`個人送信エラー (family_id: ${family.id}):`, lineError);
            errorCount++;
            continue;
          }
        }

        // 5. daily_topics テーブルに保存
        const { error: saveError } = await supabase
          .from('daily_topics')
          .insert({
            family_id: family.id,
            topic: topic,
            sent_to_user_id: sentToUserId,
          });

        if (saveError) {
          console.error(`daily_topics保存エラー (family_id: ${family.id}):`, saveError);
          // 保存エラーはログに記録するが、送信は成功しているので続行
        } else {
          console.log(`daily_topicsに保存しました (family_id: ${family.id})`);
        }

        successCount++;
      } catch (error: any) {
        console.error(`家族ID ${family.id} の処理エラー:`, error);
        errorCount++;
        // エラーが発生しても次の家族の処理を続行
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

// 家族メンバーからLINEユーザーIDを1つ取得する関数
async function getFamilyMemberLineUserId(familyId: string): Promise<string | null> {
  try {
    // family_members テーブルから家族メンバーを取得
    const { data: familyMembers, error: membersError } = await supabase
      .from('family_members')
      .select('profile_id')
      .eq('family_id', familyId)
      .limit(1);

    if (membersError || !familyMembers || familyMembers.length === 0) {
      console.error(`家族ID ${familyId}: メンバー取得エラー`, membersError);
      return null;
    }

    const profileId = familyMembers[0].profile_id;

    // profiles テーブルから line_user_id を取得
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('line_user_id')
      .eq('id', profileId)
      .single();

    if (profileError || !profile || !profile.line_user_id) {
      console.error(`家族ID ${familyId}: プロフィール取得エラー`, profileError);
      return null;
    }

    return profile.line_user_id;
  } catch (error) {
    console.error(`家族ID ${familyId}: ユーザーID取得エラー`, error);
    return null;
  }
}

