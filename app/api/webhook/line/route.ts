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



// LINE クライアント

const lineClient = new Client({ channelAccessToken });

// OpenAI クライアント

const openai = new OpenAI({ apiKey: openaiApiKey });

// Supabase クライアント

const supabase = createClient(supabaseUrl, supabaseKey);



export async function POST(req: Request) {

  try {

    const body = await req.text();

    const signature = req.headers.get('x-line-signature') || '';



    if (!validateSignature(body, channelSecret, signature)) {

      return NextResponse.json({ message: 'Invalid signature' }, { status: 200 });

    }



    const { events } = JSON.parse(body);



    for (const event of events) {

      if (event.type !== 'message' || event.message.type !== 'text') continue;



      const userId = event.source.userId;

      const groupId = event.source.groupId || event.source.roomId || null; // グループIDまたはルームID

      const text = event.message.text;



      console.log(`受信: ${text}`);



      // 1. ユーザー(profiles)の取得・作成

      let profileId = await getOrCreateUserProfile(userId);

      if (!profileId) continue;



      // 2. 家族(families)の取得・作成・メンバー登録

      let familyId = await getOrCreateFamily(profileId, userId, groupId);



      // 3. 会話ログ(conversations)に保存

      const { error: saveError } = await supabase

        .from('conversations')

        .insert({

          sender_id: profileId,

          family_id: familyId, // 家族IDを紐付ける

          content: text,

          is_ai_generated: false

        });



      if (!saveError && familyId) {

        // 4. ランダムでAIが返信 (30%)

        if (Math.random() < 0.3) {

          await handleAIResponse(familyId, profileId, groupId || userId);

        }

      }

    }



    return NextResponse.json({ message: 'OK' }, { status: 200 });

  } catch (error) {

    console.error('Error:', error);

    return NextResponse.json({ message: 'Error' }, { status: 200 });

  }

}



// ユーザープロフィールを取得または作成する関数

async function getOrCreateUserProfile(userId: string) {

  // 既存チェック

  let { data: profile } = await supabase

    .from('profiles')

    .select('id, display_name')

    .eq('line_user_id', userId)

    .single();



  if (profile) return profile.id;



  // 新規作成（名前はLINEから取得してみる）

  let displayName = 'Guest';

  try {

    const lineProfile = await lineClient.getProfile(userId);

    displayName = lineProfile.displayName;

  } catch (e) { console.log('LINEプロフィール取得失敗(ブロック中など)'); }



  const { data: newProfile, error } = await supabase

    .from('profiles')

    .insert({ line_user_id: userId, display_name: displayName, role: 'member' })

    .select('id')

    .single();

  

  if (error) { console.error('Profile作成エラー:', error); return null; }

  return newProfile.id;

}



// 家族グループを取得または作成し、メンバーを登録する関数

async function getOrCreateFamily(profileId: string, lineUserId: string, lineGroupId: string | null) {

  let familyId: string | null = null;



  if (lineGroupId) {

    // A. LINEグループの場合

    const { data: existingFamily } = await supabase

      .from('families')

      .select('id')

      .eq('line_group_id', lineGroupId)

      .single();

    

    if (existingFamily) {

      familyId = existingFamily.id;

    } else {

      // 新規グループ作成

      const { data: newFamily } = await supabase

        .from('families')

        .insert({ line_group_id: lineGroupId, name: '家族グループ' })

        .select('id')

        .single();

      familyId = newFamily?.id || null;

    }

  } else {

    // B. 1対1の場合（個人用家族枠を探す、なければ作る）

    // 自分が所属している、かつ line_group_id が null の家族を探す

    const { data: members } = await supabase

      .from('family_members')

      .select('family_id, families!inner(line_group_id)')

      .eq('user_id', profileId)

      .is('families.line_group_id', null) 

      .limit(1);



    if (members && members.length > 0) {

      familyId = members[0].family_id;

    } else {

      // 個人用家族枠を作成

      const { data: newFamily } = await supabase

        .from('families')

        .insert({ name: 'マイホーム' }) // グループIDなし

        .select('id')

        .single();

      familyId = newFamily?.id || null;

    }

  }



  // メンバー登録（まだ登録されていなければ）

  if (familyId) {

    const { error: joinError } = await supabase

      .from('family_members')

      .insert({ family_id: familyId, user_id: profileId });

    // 既に登録されている場合はエラーを無視

    if (joinError && !joinError.message.includes('duplicate')) {

      console.error('Family member登録エラー:', joinError);

    }

  }



  return familyId;

}



// AI返信ロジック

async function handleAIResponse(familyId: string | null, senderId: string, replyToId: string) {

  // 家族IDが無効な場合は早期リターン

  if (!familyId) {

    console.log('Family ID is null, skipping AI response');

    return;

  }

  // この時点でfamilyIdは確実にstring型

  const validFamilyId: string = familyId;



  // 会話履歴取得

  const { data: conversations } = await supabase

    .from('conversations')

    .select('content, is_ai_generated')

    .eq('family_id', validFamilyId) // その家族の会話を取得

    .order('sent_at', { ascending: false })

    .limit(5);



  const history = conversations ? conversations.reverse().map((c: any) => c.content).join('\n') : '';



  const completion = await openai.chat.completions.create({

    model: 'gpt-4o-mini',

    messages: [

      { role: 'system', content: 'あなたは明るい家族のマスコットです。会話の流れを読んで、30文字以内で楽しく相槌やツッコミを入れてください。' },

      { role: 'user', content: history }

    ],

    max_tokens: 60,

  });



  const aiText = completion.choices[0]?.message?.content?.trim();

  if (!aiText) return;



  await lineClient.pushMessage(replyToId, { type: 'text', text: aiText });



  await supabase.from('conversations').insert({

    sender_id: senderId,

    family_id: validFamilyId,

    content: aiText,

    is_ai_generated: true

  });

}