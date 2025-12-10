import { NextResponse } from 'next/server';
import { validateSignature } from '@line/bot-sdk';
import { createClient } from '@supabase/supabase-js';

// 環境変数のチェック
const channelSecret = process.env.LINE_CHANNEL_SECRET || '';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

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
      }
    }

    return NextResponse.json({ message: 'OK' }, { status: 200 });

  } catch (error) {
    console.error('サーバー内部エラー:', error);
    // LINEにはエラーを返さず200を返す（再送を防ぐため）
    return NextResponse.json({ message: 'Error' }, { status: 200 });
  }
}