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

export async function GET() {
  try {
    // 1. Supabaseの profiles テーブルから一番最近作成されたユーザー1名を取得
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, line_user_id')
      .order('created_at', { ascending: false })
      .limit(1);

    if (profileError) {
      console.error('プロファイル取得エラー:', profileError);
      return NextResponse.json(
        { error: 'Failed to fetch profile', details: profileError.message },
        { status: 500 }
      );
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json(
        { error: 'No profiles found' },
        { status: 404 }
      );
    }

    const profile = profiles[0];
    const lineUserId = profile.line_user_id;

    if (!lineUserId) {
      return NextResponse.json(
        { error: 'User does not have line_user_id' },
        { status: 400 }
      );
    }

    // 2. OpenAI API (gpt-4o-mini) で質問を生成
    const prompt = `あなたは陽気な司会者です。今日の天気に絡めた質問や、最近のニュースに関する質問など、家族が答えやすい話題を1つ考えてください。質問のみを返答してください。`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'あなたは家族の会話を盛り上げる話題を提供する司会者です。ユニークで具体的な質問を1つだけ生成してください。',
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
      return NextResponse.json(
        { error: 'Failed to generate topic' },
        { status: 500 }
      );
    }

    // 3. LINE Messaging API (pushMessage) で送信
    try {
      await lineClient.pushMessage(lineUserId, {
        type: 'text',
        text: topic,
      });
      console.log(`話題を送信しました: ${topic} (to ${lineUserId})`);
    } catch (lineError: any) {
      console.error('LINE送信エラー:', lineError);
      return NextResponse.json(
        {
          error: 'Failed to send message via LINE',
          details: lineError.message,
          topic: topic, // 生成された質問は返す
        },
        { status: 500 }
      );
    }

    // 4. daily_topics テーブルに保存
    const { error: saveError } = await supabase
      .from('daily_topics')
      .insert({
        family_id: null,
        topic: topic,
        sent_to_user_id: profile.id,
      });

    if (saveError) {
      console.error('daily_topics保存エラー:', saveError);
      // 保存エラーはログに記録するが、送信は成功しているので続行
    } else {
      console.log('daily_topicsに保存しました');
    }

    // 5. 実行結果として「送信した質問内容」をJSONで返す
    return NextResponse.json({
      success: true,
      topic: topic,
      sent_to: {
        user_id: profile.id,
        line_user_id: lineUserId,
      },
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





