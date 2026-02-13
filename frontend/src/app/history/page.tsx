"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Home, ArrowLeft, Book, Clock } from "lucide-react";

interface LearningRecord {
  id: number;
  user_name: string;
  word: string;
  meaning: string;
  source_level: string;
  topic: string;
  created_at: string;
}

export default function HistoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = searchParams.get("user");
  const [records, setRecords] = useState<LearningRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Use relative path '/api' which is proxied by Next.js to the backend
  // This works regardless of the external port (3000, 13900, etc.)
  const API_BASE = "/api";

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API_BASE}/learning_history?user_name=${encodeURIComponent(user)}`);
        if (res.ok) {
          const data = await res.json();
          setRecords(data);
        }
      } catch (err) {
        console.error("Failed to fetch history:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [user]);

  const handleBack = () => {
    router.push("/");
  };

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-500 mb-4">未指定用户</p>
          <button onClick={handleBack} className="text-indigo-600 underline">返回首页</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <button 
            onClick={handleBack}
            className="flex items-center text-gray-600 hover:text-indigo-600 transition-colors font-medium"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            返回首页
          </button>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center">
            <Book className="w-6 h-6 mr-2 text-indigo-600" />
            {user} 的学习记录
          </h1>
          <div className="w-20"></div> {/* Spacer */}
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : records.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center text-gray-500">
            <p>还没有学习记录哦，快去开始学习吧！</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">单词</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">中文释义</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">词库来源</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">学习主题</th>
                    <th className="px-6 py-4 text-sm font-semibold text-gray-600">学习时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {records.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-bold text-indigo-700">{record.word}</td>
                      <td className="px-6 py-4 text-gray-700">{record.meaning}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          record.source_level === "Junior High" ? "bg-green-100 text-green-700" :
                          record.source_level === "Senior High" ? "bg-blue-100 text-blue-700" :
                          record.source_level === "KET" ? "bg-yellow-100 text-yellow-700" :
                          record.source_level === "PET" ? "bg-purple-100 text-purple-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>
                          {record.source_level}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600 text-sm">{record.topic}</td>
                      <td className="px-6 py-4 text-gray-500 text-sm flex items-center">
                        <Clock className="w-3 h-3 mr-1.5" />
                        {new Date(record.created_at).toLocaleString('zh-CN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
