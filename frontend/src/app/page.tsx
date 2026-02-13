"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Sparkles, RefreshCw, Book, User, History, LogOut, Trophy, Calculator, Languages, ArrowLeft, Gamepad2 } from "lucide-react";
import { vocabularyDict } from "@/data/vocabulary";
import { USER_RESTRICTIONS } from "@/data/restrictions";

const USERS = ["爸爸", "妈妈", "天天", "QQ乐"];

interface LeaderboardEntry {
  user_name: string;
  count: number;
}

function Leaderboard() {
  const [activeTab, setActiveTab] = useState<"daily" | "weekly" | "total">("daily");
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLoading(true);
      try {
        const API_BASE = "/api";
        const res = await fetch(`${API_BASE}/leaderboard?type=${activeTab}`);
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (e) {
        console.error("Failed to fetch leaderboard", e);
      } finally {
        setLoading(false);
      }
    };
    fetchLeaderboard();
  }, [activeTab]);

  return (
    <div className="w-full bg-white rounded-2xl shadow-xl p-6 mt-6">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="text-yellow-500 w-6 h-6" />
        <h2 className="text-xl font-bold text-gray-800">学习榜单</h2>
      </div>

      <div className="flex gap-2 mb-4 p-1 bg-gray-100 rounded-lg">
        {(["daily", "weekly", "total"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
              activeTab === tab
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "daily" && "今日"}
            {tab === "weekly" && "本周"}
            {tab === "total" && "总榜"}
          </button>
        ))}
      </div>

      <div className="space-y-3 min-h-[200px]">
        {loading ? (
          <div className="flex justify-center items-center h-full py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
          </div>
        ) : data.length === 0 ? (
          <div className="text-center text-gray-400 py-8 text-sm">暂无数据，快去学习吧！</div>
        ) : (
          data.map((entry, index) => (
            <div
              key={entry.user_name}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${
                    index === 0
                      ? "bg-yellow-100 text-yellow-700"
                      : index === 1
                      ? "bg-gray-200 text-gray-700"
                      : index === 2
                      ? "bg-orange-100 text-orange-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {index + 1}
                </div>
                <span className="font-medium text-gray-700">{entry.user_name}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-indigo-600 font-bold">{entry.count}</span>
                <span className="text-xs text-gray-400">词</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<string | null>(null);
  const [view, setView] = useState<"hub" | "wordweaver">("hub"); // "hub" or "wordweaver"
  
  // WordWeaver State
  const [words, setWords] = useState("");
  const [topic, setTopic] = useState("Daily Life");
  const [selectedLevel, setSelectedLevel] = useState<"Junior High" | "Senior High" | "KET" | "PET" | "Postgraduate" | null>(null);

  useEffect(() => {
    const savedUser = localStorage.getItem("wordweaver_user");
    if (savedUser && USERS.includes(savedUser)) {
      setUser(savedUser);
    }
  }, []);

  const handleUserSelect = (name: string) => {
    setUser(name);
    localStorage.setItem("wordweaver_user", name);
  };

  const handleLogout = () => {
    setUser(null);
    setView("hub");
    localStorage.removeItem("wordweaver_user");
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!words.trim() || !user) return;

    const wordList = words.split(/[,，\n]+/).map((w) => w.trim()).filter(Boolean);
    if (wordList.length === 0) return;

    const params = new URLSearchParams();
    wordList.forEach((w) => params.append("words", w));
    params.set("topic", topic);
    params.set("user", user);
    if (selectedLevel) {
      params.set("sourceLevel", selectedLevel);
    }

    router.push(`/learning?${params.toString()}`);
  };

  const handleHistory = () => {
      if (user) {
          router.push(`/history?user=${encodeURIComponent(user)}`);
      }
  };

  const handleGenerateWords = (level: "Junior High" | "Senior High" | "KET" | "PET" | "Postgraduate") => {
    setSelectedLevel(level);
    const vocabList = vocabularyDict[level];
    const shuffled = [...vocabList].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 5);
    setWords(selected.join(", "));
  };

  const isLevelRestricted = (level: string) => {
    if (!user) return false;
    const restrictedLevels = USER_RESTRICTIONS[user] || [];
    return restrictedLevels.includes(level);
  };

  // Login View
  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gradient-to-br from-indigo-50 to-blue-100">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 space-y-8">
          <div className="text-center space-y-2">
            <div className="flex justify-center">
              <div className="bg-indigo-600 p-3 rounded-xl">
                <BookOpen className="w-8 h-8 text-white" />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">AI 智学乐园</h1>
            <p className="text-gray-500">情景化学习，快乐成长</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {USERS.map((name) => (
              <button
                key={name}
                onClick={() => handleUserSelect(name)}
                className="flex flex-col items-center justify-center p-6 bg-gray-50 hover:bg-indigo-50 border-2 border-transparent hover:border-indigo-200 rounded-xl transition-all group"
              >
                <div className="bg-white p-3 rounded-full shadow-sm mb-3 group-hover:scale-110 transition-transform">
                  <User className="w-8 h-8 text-indigo-600" />
                </div>
                <span className="font-bold text-gray-700 group-hover:text-indigo-700">{name}</span>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  // Hub View
  if (view === "hub") {
    return (
      <main className="flex min-h-screen flex-col items-center p-4 bg-gradient-to-br from-indigo-50 to-blue-100">
        <div className="w-full max-w-md space-y-6">
          {/* Header */}
          <div className="bg-white rounded-2xl shadow-lg p-4 flex justify-between items-center">
             <div className="flex items-center space-x-2">
                <div className="bg-indigo-100 p-2 rounded-full">
                    <User className="w-5 h-5 text-indigo-600" />
                </div>
                <span className="font-bold text-gray-800">{user}</span>
            </div>
            <div className="flex space-x-2">
                <button 
                    onClick={handleHistory}
                    className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 rounded-lg transition-colors"
                    title="学习记录"
                >
                    <History className="w-5 h-5" />
                </button>
                <button 
                    onClick={handleLogout}
                    className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="切换用户"
                >
                    <LogOut className="w-5 h-5" />
                </button>
            </div>
          </div>

          {/* Title */}
          <div className="text-center py-4">
             <h1 className="text-2xl font-bold text-gray-900 flex items-center justify-center gap-2">
                <Gamepad2 className="w-8 h-8 text-indigo-600" />
                AI 智学乐园
             </h1>
             <p className="text-gray-500 text-sm">选择你的学习冒险</p>
          </div>

          {/* Game Selection Grid */}
          <div className="grid gap-4">
             {/* English - Active */}
             <button 
                onClick={() => setView("wordweaver")}
                className="bg-white p-6 rounded-2xl shadow-lg border-2 border-indigo-100 hover:border-indigo-300 transition-all flex items-center justify-between group"
             >
                <div className="flex items-center gap-4">
                    <div className="bg-indigo-100 p-4 rounded-xl group-hover:bg-indigo-200 transition-colors">
                        <BookOpen className="w-8 h-8 text-indigo-600" />
                    </div>
                    <div className="text-left">
                        <h3 className="text-lg font-bold text-gray-900">英语世界</h3>
                        <p className="text-sm text-indigo-600 font-medium">WordWeaver</p>
                    </div>
                </div>
                <div className="text-gray-300 group-hover:text-indigo-400">
                    <Sparkles className="w-6 h-6" />
                </div>
             </button>

             {/* Math - Disabled */}
             <button disabled className="bg-gray-50 p-6 rounded-2xl border-2 border-transparent opacity-75 cursor-not-allowed flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="bg-gray-200 p-4 rounded-xl">
                        <Calculator className="w-8 h-8 text-gray-500" />
                    </div>
                    <div className="text-left">
                        <h3 className="text-lg font-bold text-gray-500">数学思维</h3>
                        <p className="text-sm text-gray-400">即将推出</p>
                    </div>
                </div>
             </button>

             {/* Chinese - Disabled */}
             <button disabled className="bg-gray-50 p-6 rounded-2xl border-2 border-transparent opacity-75 cursor-not-allowed flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="bg-gray-200 p-4 rounded-xl">
                        <Languages className="w-8 h-8 text-gray-500" />
                    </div>
                    <div className="text-left">
                        <h3 className="text-lg font-bold text-gray-500">语文素养</h3>
                        <p className="text-sm text-gray-400">即将推出</p>
                    </div>
                </div>
             </button>
          </div>
          
          <Leaderboard />
        </div>
      </main>
    );
  }

  // WordWeaver View
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gradient-to-br from-indigo-50 to-blue-100">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 space-y-6 relative">
        {/* Back Button */}
        <button 
            onClick={() => setView("hub")}
            className="absolute top-4 left-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
        >
            <ArrowLeft className="w-6 h-6" />
        </button>

        <div className="flex justify-between items-center pb-4 border-b border-gray-100 pl-10">
            <div className="flex items-center space-x-2">
                <div className="bg-indigo-100 p-2 rounded-full">
                    <User className="w-5 h-5 text-indigo-600" />
                </div>
                <span className="font-bold text-gray-800">{user}</span>
            </div>
            {/* Keeping Logout/History accessible here too or simplifying? Let's keep them */}
             <div className="flex space-x-2">
                <button 
                    onClick={handleHistory}
                    className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-gray-100 rounded-lg transition-colors"
                    title="学习记录"
                >
                    <History className="w-5 h-5" />
                </button>
            </div>
        </div>

        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="bg-indigo-600 p-3 rounded-xl">
              <BookOpen className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">WordWeaver</h1>
          <p className="text-gray-500">AI 驱动的语境学习助手</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 block">
            快速生成词库
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => handleGenerateWords("Junior High")}
              disabled={isLevelRestricted("Junior High")}
              className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-1 ${
                selectedLevel === "Junior High"
                  ? "bg-indigo-100 text-indigo-700 border border-indigo-200"
                  : isLevelRestricted("Junior High")
                  ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed opacity-50"
                  : "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100"
              }`}
              title={isLevelRestricted("Junior High") ? "该等级暂不可用" : ""}
            >
              <Book size={14} />
              <span>初中</span>
            </button>
            <button
              type="button"
              onClick={() => handleGenerateWords("Senior High")}
              disabled={isLevelRestricted("Senior High")}
              className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-1 ${
                selectedLevel === "Senior High"
                  ? "bg-indigo-100 text-indigo-700 border border-indigo-200"
                  : isLevelRestricted("Senior High")
                  ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed opacity-50"
                  : "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100"
              }`}
              title={isLevelRestricted("Senior High") ? "该等级暂不可用" : ""}
            >
              <Book size={14} />
              <span>高中</span>
            </button>
            <button
              type="button"
              onClick={() => handleGenerateWords("KET")}
              disabled={isLevelRestricted("KET")}
              className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-1 ${
                selectedLevel === "KET"
                  ? "bg-indigo-100 text-indigo-700 border border-indigo-200"
                  : isLevelRestricted("KET")
                  ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed opacity-50"
                  : "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100"
              }`}
              title={isLevelRestricted("KET") ? "该等级暂不可用" : ""}
            >
              <Book size={14} />
              <span>KET</span>
            </button>
            <button
              type="button"
              onClick={() => handleGenerateWords("PET")}
              disabled={isLevelRestricted("PET")}
              className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-1 ${
                selectedLevel === "PET"
                  ? "bg-indigo-100 text-indigo-700 border border-indigo-200"
                  : isLevelRestricted("PET")
                  ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed opacity-50"
                  : "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100"
              }`}
              title={isLevelRestricted("PET") ? "该等级暂不可用" : ""}
            >
              <Book size={14} />
              <span>PET</span>
            </button>
            <button
              type="button"
              onClick={() => handleGenerateWords("Postgraduate")}
              disabled={isLevelRestricted("Postgraduate")}
              className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-1 ${
                selectedLevel === "Postgraduate"
                  ? "bg-indigo-100 text-indigo-700 border border-indigo-200"
                  : isLevelRestricted("Postgraduate")
                  ? "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed opacity-50"
                  : "bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100"
              }`}
              title={isLevelRestricted("Postgraduate") ? "该等级暂不可用" : ""}
            >
              <Book size={14} />
              <span>考研</span>
            </button>
            <button
              type="button"
              onClick={() => selectedLevel && handleGenerateWords(selectedLevel)}
              disabled={!selectedLevel}
              className="py-2 px-3 rounded-lg text-sm font-medium bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              title="刷新单词"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <form onSubmit={handleStart} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              要学习的单词 (手动输入或自动生成)
            </label>
            <textarea
              className="w-full h-32 p-4 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
              placeholder="例如: ephemeral, serendipity, resilience..."
              value={words}
              onChange={(e) => setWords(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              选择故事主题
            </label>
            <select
              className="w-full p-3 rounded-lg border border-gray-200 focus:ring-2 focus:ring-indigo-500 bg-white"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            >
              <option value="Daily Life">日常生活 (Daily Life)</option>
              <option value="Harry Potter">哈利波特 (Harry Potter)</option>
              <option value="The Avengers">复仇者联盟 (The Avengers)</option>
              <option value="Art">艺术人文 (Art)</option>
              <option value="Minecraft">我的世界 (Minecraft)</option>
              <option value="Jokes">笑话 (Jokes)</option>
              <option value="Chinese History">中国历史 (Chinese History)</option>
              <option value="Western History">欧美历史 (Western History)</option>
              <option value="Astronomy">天文 (Astronomy)</option>
              <option value="Geography">地理 (Geography)</option>
              <option value="Math">数学 (Math)</option>
              <option value="Physics">物理 (Physics)</option>
              <option value="Informatics">信息学 (Informatics)</option>
              <option value="Biology">生物 (Biology)</option>
              <option value="Chemistry">化学 (Chemistry)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={!words.trim()}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-5 h-5" />
            <span>开始学习</span>
          </button>
        </form>
      </div>
    </main>
  );
}
