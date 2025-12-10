import { NextResponse } from 'next/server';
import { validateSignature, Client } from '@line/bot-sdk';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// 環境変数のチェック
const channelSecret = process.env.LINE_CHANNEL_SECRET || '';
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const openaiApiKey = process.env.OPENAI_API_KEY || '';

// LINE クライアントの作成
const lineClient = new Client({
  channelAccessToken: channelAccessToken,
});

// OpenAI クライアントの作成
const openai = new OpenAI({
  apiKey: openaiApiKey,
});

export async function POST(req: Request) {
  try {
    // 1. リクエストボディをテキストとして取得（署名検証に必須）
    const body = await req.text();
    const signature = req.headers.get('x-line-signature') || '';

    // 2. 署名検証（LINEからのアクセスであることを証明）
    if (!validateSignature(body, channelSecret, signature)) {
      console.error('署名検証エラー: 不正なアクセスです');
      return NextResponse.json({ message: 'Invalid signature' }, { status: 200 });
    }

    // 3. イベントの処理
    const { events } = JSON.parse(body);
    
    // Supabaseクライアント作成
    const supabase = createClient(supabaseUrl, supabaseKey);

    // イベントごとに処理
    for (const event of events) {
      // テキストメッセージ以外は無視
      if (event.type !== 'message' || event.message.type !== 'text') {
        continue;
      }

      const userId = event.source.userId;
      const text = event.message.text;
      
      console.log(`受信: ${text} (from ${userId})`);

      // 4. ユーザー(profiles)の確認・作成
      // まずユーザーがいるか確認
      let { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('line_user_id', userId)
        .single();

      // いなければ作成
      if (!profile) {
        console.log('新規ユーザーを作成します');
        const { data: newProfile, error: profileError } = await supabase
          .from('profiles')
          .insert({
            line_user_id: userId,
            display_name: 'Guest', // 仮の名前
            role: 'unknown'
          })
          .select('id')
          .single();
        
        if (profileError) {
          console.error('ユーザー作成エラー:', profileError);
          continue; 
        }
        profile = newProfile;
      }

      // 5. 会話ログ(conversations)に保存
      const { error: saveError } = await supabase
        .from('conversations')
        .insert({
          sender_id: profile?.id,
          content: text,
          family_id: null, // 1対1なのでまだ家族IDは無し
          is_ai_generated: false
        });

      if (saveError) {
        console.error('保存エラー:', saveError);
      } else {
        console.log('会話を保存しました！');

        // 6. 約30%の確率でAIが会話に参加
        if (Math.random() < 0.3) {
          try {
            await handleAIResponse(profile.id, userId, supabase);
          } catch (aiError) {
            // AI参加処理でエラーが発生しても、LINE側には200を返す
            console.error('AI参加処理エラー:', aiError);
          }
        }
      }
    }

    return NextResponse.json({ message: 'OK' }, { status: 200 });

  } catch (error) {
    console.error('サーバー内部エラー:', error);
    // LINEにはエラーを返さず200を返す（再送を防ぐため）
    return NextResponse.json({ message: 'Error' }, { status: 200 });
  }
}

// AIが会話に参加する処理
async function handleAIResponse(senderId: string, lineUserId: string, supabase: any) {
  try {
    // 家族の直近5件の会話履歴を取得
    // family_idがnullの場合は、そのユーザーの会話履歴を取得
    const { data: conversations, error: conversationsError } = await supabase
      .from('conversations')
      .select('content, is_ai_generated')
      .eq('sender_id', senderId)
      .order('sent_at', { ascending: false })
      .limit(5);

    if (conversationsError) {
      console.error('会話履歴取得エラー:', conversationsError);
      return;
    }

    if (!conversations || conversations.length === 0) {
      console.log('会話履歴がありません');
      return;
    }

    // 会話履歴をテキストに整形（AI生成メッセージは除外して、ユーザーのメッセージのみ）
    const userMessages = conversations
      .filter((conv: any) => !conv.is_ai_generated)
      .map((conv: any) => conv.content)
      .reverse(); // 時系列順に

    if (userMessages.length === 0) {
      console.log('ユーザーメッセージがありません');
      return;
    }

    const conversationHistory = userMessages.join('\n');

    // OpenAI APIでメッセージ生成
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'あなたは家族の会話を見守る陽気なマスコットです。直近の会話の流れを読み、30文字以内で楽しく反応してください。質問はせず、感想やリアクションにとどめてください。',
        },
        {
          role: 'user',
          content: `以下の会話履歴を読んで、短くて明るい相槌やツッコミを1つ生成してください。\n\n${conversationHistory}`,
        },
      ],
      max_tokens: 50,
      temperature: 0.8,
    });

    const aiMessage = completion.choices[0]?.message?.content?.trim();
    if (!aiMessage) {
      console.error('AIメッセージ生成失敗');
      return;
    }

    // LINEに送信
    await lineClient.pushMessage(lineUserId, {
      type: 'text',
      text: aiMessage,
    });

    console.log(`AIメッセージを送信しました: ${aiMessage}`);

    // AIメッセージをconversationsテーブルに保存
    const { error: saveError } = await supabase
      .from('conversations')
      .insert({
        sender_id: senderId,
        content: aiMessage,
        family_id: null,
        is_ai_generated: true,
      });

    if (saveError) {
      console.error('AIメッセージ保存エラー:', saveError);
    } else {
      console.log('AIメッセージを保存しました');
    }
  } catch (error) {
    console.error('AI参加処理エラー:', error);
    throw error; // エラーを再スロー（呼び出し元でキャッチされる）
  }
}