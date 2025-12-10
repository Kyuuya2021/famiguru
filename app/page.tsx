'use client';

import { useEffect, useState } from 'react';
import liff from '@line/liff';
import { createClient } from '@supabase/supabase-js';

// Supabase クライアントの作成
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

interface Profile {
  id: string;
  line_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

// 修正箇所1: 型定義を sent_at に変更
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
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [conversations, setConversations] = useState<ConversationGroup[]>([]);
  const [lineUserId, setLineUserId] = useState<string | null>(null);

  useEffect(() => {
    const initLiff = async () => {
      try {
        // LIFF初期化
        const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
        if (!liffId) {
          throw new Error('LIFF ID is not configured');
        }

        await liff.init({ liffId });

        // LINEプロフィール取得
        let profile;
        try {
          profile = await liff.getProfile();
          setLineUserId(profile.userId);
        } catch (err: any) {
          // LIFF外で開いた場合やログインしていない場合
          console.warn('LINEプロフィール取得失敗:', err);
          if (!liff.isLoggedIn()) {
            setError('LINEアプリ内で開くか、ログインしてください。');
            setLoading(false);
            return;
          }
          throw err;
        }

        // Supabaseからデータ取得
        await fetchUserData(profile.userId);
      } catch (err: any) {
        console.error('LIFF初期化エラー:', err);
        setError(err.message || 'アプリの初期化に失敗しました');
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
        .select('id, line_user_id, display_name, avatar_url')
        .eq('line_user_id', userId)
        .single();

      if (profileError && profileError.code !== 'PGRST116') {
        throw new Error(`プロフィール取得エラー: ${profileError.message}`);
      }

      if (profileData) {
        setProfile(profileData);
      }

      // 会話履歴取得
      if (profileData) {
        // 修正箇所2: クエリのカラム名と並び替え基準を sent_at に変更
        const { data: conversationsData, error: conversationsError } = await supabase
          .from('conversations')
          .select('id, content, sent_at, sender_id')
          .eq('sender_id', profileData.id)
          .order('sent_at', { ascending: false });

        if (conversationsError) {
          throw new Error(`会話履歴取得エラー: ${conversationsError.message}`);
        }

        if (conversationsData) {
          // 日付ごとにグループ化
          const grouped = groupConversationsByDate(conversationsData);
          setConversations(grouped);
        }
      }
    } catch (err: any) {
      console.error('データ取得エラー:', err);
      setError(err.message || 'データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const groupConversationsByDate = (conversations: Conversation[]): ConversationGroup[] => {
    const groups: { [key: string]: Conversation[] } = {};

    conversations.forEach((conv) => {
      // 修正箇所3: 日付処理の参照先を sent_at に変更
      const date = new Date(conv.sent_at);
      const dateKey = date.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(conv);
    });

    return Object.entries(groups).map(([date, convs]) => ({
      date,
      conversations: convs,
    }));
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-orange-400 border-t-transparent mb-4"></div>
          <p className="text-orange-700 text-lg">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-orange-800 mb-2">エラーが発生しました</h2>
          <p className="text-orange-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 via-orange-50 to-amber-100">
      {/* ヘッダー */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-orange-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-white text-xl font-bold shadow-md">
              {profile?.display_name?.charAt(0) || '👤'}
            </div>
            <div>
              <h1 className="text-xl font-bold text-orange-900">ふぁみぐる</h1>
              <p className="text-sm text-orange-600">
                {profile?.display_name || 'ゲスト'}さんの会話記録
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        {conversations.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">📝</div>
            <p className="text-orange-700 text-lg">まだ会話がありません</p>
            <p className="text-orange-600 text-sm mt-2">LINEでメッセージを送信すると、ここに表示されます</p>
          </div>
        ) : (
          <div className="space-y-8">
            {conversations.map((group, groupIndex) => (
              <div key={groupIndex} className="bg-white/60 rounded-2xl p-6 shadow-md border border-orange-200/50">
                {/* 日付ヘッダー */}
                <div className="flex items-center gap-3 mb-6 pb-3 border-b border-orange-200">
                  <div className="w-1 h-8 bg-gradient-to-b from-orange-400 to-amber-500 rounded-full"></div>
                  <h2 className="text-lg font-bold text-orange-900">{group.date}</h2>
                </div>

                {/* 会話リスト */}
                <div className="space-y-4">
                  {group.conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className="bg-gradient-to-r from-white to-amber-50/50 rounded-xl p-4 shadow-sm border border-orange-100 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start gap-3">
                        {/* アバター */}
                        <div className="flex-shrink-0">
                          {profile?.avatar_url ? (
                            <img
                              src={profile.avatar_url}
                              alt={profile.display_name || 'ユーザー'}
                              className="w-10 h-10 rounded-full object-cover border-2 border-orange-300"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-white text-sm font-bold border-2 border-orange-300">
                              {profile?.display_name?.charAt(0) || '👤'}
                            </div>
                          )}
                        </div>

                        {/* メッセージ内容 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold text-orange-800">
                              {profile?.display_name || 'あなた'}
                            </span>
                            <span className="text-xs text-orange-500">
                              {/* 修正箇所4: 表示用データも sent_at に変更 */}
                              {formatTime(conv.sent_at)}
                            </span>
                          </div>
                          <p className="text-orange-900 leading-relaxed whitespace-pre-wrap break-words">
                            {conv.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* フッター */}
      <footer className="max-w-2xl mx-auto px-4 py-6 text-center">
        <p className="text-orange-600 text-sm">© ふぁみぐる</p>
      </footer>
    </div>
  );
}