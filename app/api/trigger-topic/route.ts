import { NextResponse } from 'next/server';

import { Client } from '@line/bot-sdk';

import { createClient } from '@supabase/supabase-js';

import OpenAI from 'openai';



// 環境変数の取得

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const openaiApiKey = process.env.OPENAI_API_KEY || '';



// クライアント初期化

const lineClient = new Client({ channelAccessToken });

const supabase = createClient(supabaseUrl, supabaseKey);

const openai = new OpenAI({ apiKey: openaiApiKey });



export async function POST(req: Request) {

  try {

    const { lineUserId } = await req.json();



    if (!lineUserId) {

      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });

    }



    // 1. ユーザーと家族情報の特定

    const memberInfo = await getUserFamilyInfo(lineUserId);

    if (!memberInfo) {

      return NextResponse.json({ error: 'Family not found' }, { status: 404 });

    }



    // 2. OpenAIで話題生成

    const completion = await openai.chat.completions.create({

      model: 'gpt-4o-mini',

      messages: [

        {

          role: 'system',

          content: 'あなたは家族の会話を盛り上げる陽気な司会者です。今この瞬間に家族で話せる、ユニークで具体的な話題を1つ提供してください。「ガチャ」で引いたようなワクワクする質問が良いです。質問のみを返してください。',

        },

        { role: 'user', content: '話題ガチャを回します！' },

      ],

      max_tokens: 100,

    });



    const topic = completion.choices[0]?.message?.content?.trim();

    if (!topic) throw new Error('Topic generation failed');



    // 3. LINEへ送信（グループまたは個人）

    // UIで表示するだけでなく、LINEにも残すことで「あとで話そう」となる

    const targetId = memberInfo.lineGroupId || memberInfo.lineUserId;

    await lineClient.pushMessage(targetId, {

      type: 'text',

      text: `💊 話題ガチャが出ました！\n\n「${topic}」`,

    });



    // 4. データベース保存（ログと話題）

    // conversationテーブル（履歴用）

    await supabase.from('conversations').insert({

      family_id: memberInfo.familyId,

      sender_id: memberInfo.profileId,

      content: `話題ガチャ: ${topic}`,

      is_ai_generated: true,

    });



    // daily_topicsテーブル（集計用）

    await supabase.from('daily_topics').insert({

      family_id: memberInfo.familyId,

      topic: topic,

      sent_to_user_id: memberInfo.profileId,

    });



    return NextResponse.json({ topic });



  } catch (error: any) {

    console.error('ガチャエラー:', error);

    return NextResponse.json({ error: error.message }, { status: 500 });

  }

}



// ヘルパー: LINE IDから家族情報を取得

async function getUserFamilyInfo(lineUserId: string) {

  // プロフィール取得

  const { data: profile } = await supabase

    .from('profiles')

    .select('id')

    .eq('line_user_id', lineUserId)

    .single();

  

  if (!profile) return null;



  // 所属する家族を取得（1つのみと仮定）

  const { data: member } = await supabase

    .from('family_members')

    .select('family_id, families!inner(line_group_id)')

    .eq('user_id', profile.id)

    .limit(1)

    .single();



  if (!member) return null;



  // familiesは配列として返される可能性があるため、最初の要素を取得

  const families = member.families as { line_group_id: string | null }[] | null;

  const lineGroupId = families && families.length > 0 ? families[0].line_group_id : null;



  return {

    profileId: profile.id,

    familyId: member.family_id,

    lineUserId: lineUserId,

    lineGroupId: lineGroupId

  };

}

