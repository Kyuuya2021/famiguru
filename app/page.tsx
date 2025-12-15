'use client';



import { useEffect, useState } from 'react';

import liff from '@line/liff';

import { createClient } from '@supabase/supabase-js';



// Supabase設定

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);



// 型定義

interface Profile {

  id: string;

  line_user_id: string;

  display_name: string | null;

  avatar_url: string | null;

}



interface Conversation {

  id: string;

  content: string;

  sent_at: string;

  sender_id: string;

}



interface ConversationGroup {

  date: string;

  conversations: Conversation[];

}



export default function Home() {

  const [loading, setLoading] = useState(true);

  const [profile, setProfile] = useState<Profile | null>(null);

  const [conversations, setConversations] = useState<ConversationGroup[]>([]);

  

  // ガチャ用の状態

  const [isGachaOpen, setIsGachaOpen] = useState(false);

  const [isGachaAnimating, setIsGachaAnimating] = useState(false);

  const [gachaResult, setGachaResult] = useState<string | null>(null);



  useEffect(() => {

    const initLiff = async () => {

      try {

        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

        if (!liffId) throw new Error('LIFF ID missing');

        await liff.init({ liffId });



        if (!liff.isLoggedIn()) {

          liff.login();

          return;

        }



        const liffProfile = await liff.getProfile();

        await fetchUserData(liffProfile.userId);

      } catch (err) {

        console.error(err);

        setLoading(false);

      }

    };

    initLiff();

  }, []);



  const fetchUserData = async (userId: string) => {

    try {

      // プロフィール取得

      const { data: profileData, error: profileError } = await supabase

        .from('profiles')

        .select('*')

        .eq('line_user_id', userId)

        .single();



      if (profileError && profileError.code !== 'PGRST116') {

        throw new Error(`プロフィール取得エラー: ${profileError.message}`);

      }



      if (profileData) {

        setProfile(profileData);

        

        // 家族IDを取得

        const familyId = await getFamilyId(profileData.id);

        

        if (familyId) {

          // 家族の会話履歴を取得

          const { data: convData, error: convError } = await supabase

            .from('conversations')

            .select('*')

            .eq('family_id', familyId)

            .order('sent_at', { ascending: false });



          if (convError) {

            throw new Error(`会話履歴取得エラー: ${convError.message}`);

          }



          if (convData) {

            setConversations(groupConversationsByDate(convData));

          }

        }

      }

    } catch (err: any) {

      console.error('データ取得エラー:', err);

    } finally {

      setLoading(false);

    }

  };



  // ユーザーIDから家族IDを取得するヘルパー

  const getFamilyId = async (userId: string): Promise<string | null> => {

    try {

      const { data, error } = await supabase

        .from('family_members')

        .select('family_id')

        .eq('user_id', userId)

        .limit(1)

        .single();



      if (error) {

        console.error('家族ID取得エラー:', error);

        return null;

      }



      return data?.family_id || null;

    } catch (error) {

      console.error('家族ID取得エラー:', error);

      return null;

    }

  };



  // ガチャを引く関数

  const playGacha = async () => {

    if (!profile) {

      alert('プロフィールが読み込まれていません。しばらく待ってから再度お試しください。');

      return;

    }

    setIsGachaOpen(true);

    setIsGachaAnimating(true);

    setGachaResult(null);



    try {

      // API呼び出し

      const res = await fetch('/api/trigger-topic', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ lineUserId: profile.line_user_id }),

      });

      

      if (!res.ok) {

        throw new Error('ガチャAPI呼び出しに失敗しました');

      }

      

      const data = await res.json();

      

      // アニメーション用に少し待つ

      setTimeout(() => {

        setIsGachaAnimating(false);

        setGachaResult(data.topic);

        // 履歴を再取得して更新

        fetchUserData(profile.line_user_id);

      }, 2000);



    } catch (e) {

      console.error(e);

      setIsGachaAnimating(false);

      setGachaResult('エラーが発生しました。もう一度お試しください。');

    }

  };



  // 日付グルーピング関数

  const groupConversationsByDate = (conversations: Conversation[]): ConversationGroup[] => {

    const groups: { [key: string]: Conversation[] } = {};

    conversations.forEach((conv) => {

      const date = new Date(conv.sent_at);

      const key = date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

      if (!groups[key]) groups[key] = [];

      groups[key].push(conv);

    });

    return Object.entries(groups).map(([date, convs]) => ({ date, conversations: convs }));

  };



  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-orange-50 text-orange-400">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-orange-400 border-t-transparent mb-4"></div>
          <p className="text-orange-700 text-lg">読み込み中...</p>
        </div>
      </div>
    );
  }



  return (

    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-100 pb-24">

      {/* ヘッダー */}

      <header className="bg-white/90 backdrop-blur shadow-sm sticky top-0 z-10 px-4 py-3 flex items-center gap-3">

        <div className="w-10 h-10 rounded-full bg-orange-400 flex items-center justify-center text-white font-bold">

          {profile?.display_name?.[0] || 'G'}

        </div>

        <h1 className="font-bold text-orange-900">家族の思い出帳</h1>

      </header>



      {/* メインリスト */}

      <main className="p-4 space-y-6">

        {conversations.length === 0 ? (

          <div className="text-center py-16">

            <div className="text-6xl mb-4">📝</div>

            <p className="text-orange-700 text-lg">まだ会話がありません</p>

            <p className="text-orange-600 text-sm mt-2">LINEでメッセージを送信すると、ここに表示されます</p>

          </div>

        ) : (

          conversations.map((group) => (

            <div key={group.date}>

              <h2 className="text-sm font-bold text-orange-600 mb-2 px-2 border-l-4 border-orange-400">{group.date}</h2>

              <div className="space-y-3">

                {group.conversations.map((conv) => (

                  <div key={conv.id} className={`p-3 rounded-xl shadow-sm border ${conv.sender_id === profile?.id ? 'bg-orange-50 border-orange-200' : 'bg-white border-white'}`}>

                    <p className="text-gray-800 text-sm whitespace-pre-wrap">{conv.content}</p>

                    <p className="text-xs text-gray-400 mt-1 text-right">

                      {new Date(conv.sent_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}

                    </p>

                  </div>

                ))}

              </div>

            </div>

          ))

        )}

      </main>



      {/* ガチャボタン（FAB） */}

      <button 

        onClick={playGacha}

        disabled={isGachaAnimating || loading || !profile}

        className="fixed bottom-6 right-6 w-16 h-16 bg-gradient-to-br from-pink-500 to-orange-500 rounded-full shadow-lg flex items-center justify-center text-3xl hover:scale-110 transition-transform active:scale-95 z-50 border-4 border-white disabled:opacity-50 disabled:cursor-not-allowed"

        aria-label="話題ガチャを引く"

        title={!profile ? "プロフィールを読み込み中..." : "話題ガチャを引く"}

      >

        💊

      </button>



      {/* ガチャ演出モーダル */}

      {isGachaOpen && (

        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">

          <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center relative overflow-hidden shadow-2xl">

            <button 

              onClick={() => setIsGachaOpen(false)}

              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl"

            >

              ✕

            </button>



            {isGachaAnimating ? (

              <div className="py-10">

                <div className="text-6xl mb-4 shake-animation">💊</div>

                <p className="text-orange-600 font-bold animate-pulse">話題を考え中...</p>

              </div>

            ) : (

              <div className="py-4 fade-in-zoom">

                <div className="text-5xl mb-4">✨</div>

                <h3 className="text-xl font-bold text-orange-800 mb-4">今日の話題！</h3>

                <p className="text-lg text-gray-700 font-medium leading-relaxed border-2 border-dashed border-orange-200 p-4 rounded-xl bg-orange-50">

                  {gachaResult}

                </p>

                <p className="text-xs text-gray-400 mt-4">※LINEグループにも送信しました</p>

                <button

                  onClick={() => setIsGachaOpen(false)}

                  className="mt-6 w-full py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors"

                >

                  会話する！

                </button>

              </div>

            )}

          </div>

        </div>

      )}

      

      <style jsx>{`

        @keyframes shake {

          0% { transform: translate(1px, 1px) rotate(0deg); }

          10% { transform: translate(-1px, -2px) rotate(-1deg); }

          20% { transform: translate(-3px, 0px) rotate(1deg); }

          30% { transform: translate(3px, 2px) rotate(0deg); }

          40% { transform: translate(1px, -1px) rotate(1deg); }

          50% { transform: translate(-1px, 2px) rotate(-1deg); }

          60% { transform: translate(-3px, 1px) rotate(0deg); }

          70% { transform: translate(3px, 1px) rotate(-1deg); }

          80% { transform: translate(-1px, -1px) rotate(1deg); }

          90% { transform: translate(1px, 2px) rotate(0deg); }

          100% { transform: translate(1px, -2px) rotate(-1deg); }

        }

        @keyframes fadeInZoom {

          0% { 

            opacity: 0;

            transform: scale(0.8);

          }

          100% { 

            opacity: 1;

            transform: scale(1);

          }

        }

        .shake-animation {

          animation: shake 0.5s infinite;

        }

        .fade-in-zoom {

          animation: fadeInZoom 0.3s ease-out;

        }

      `}</style>

    </div>

  );

}
