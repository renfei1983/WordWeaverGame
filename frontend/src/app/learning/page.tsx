"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { Loader2, CheckCircle, XCircle, Trophy, ArrowRight, RefreshCcw, Home, FastForward, ChevronDown, ChevronUp } from "lucide-react";
import { vocabularyDict } from "@/data/vocabulary";

interface QuizQuestion {
  question: string;
  options: string[];
  answer: string;
}

interface StoryData {
  content: string;
  translation: string;
  translation_map: Record<string, string>;
  quiz: QuizQuestion[];
}

const storyCache = new Map<string, StoryData>();
const prefetchQueue: string[][] = [];
const pendingKeys = new Set<string>();

// Helper to persist/restore cache
const saveToStorage = () => {
  if (typeof window === "undefined") return;
  try {
    const cacheObj = Object.fromEntries(storyCache);
    sessionStorage.setItem("ww_story_cache", JSON.stringify(cacheObj));
    sessionStorage.setItem("ww_prefetch_queue", JSON.stringify(prefetchQueue));
  } catch (e) {
    console.warn("Failed to save cache to storage", e);
  }
};

const loadFromStorage = () => {
  if (typeof window === "undefined") return;
  try {
    const cached = sessionStorage.getItem("ww_story_cache");
    if (cached) {
      const cacheObj = JSON.parse(cached);
      Object.entries(cacheObj).forEach(([k, v]) => storyCache.set(k, v as StoryData));
    }
    
    const queue = sessionStorage.getItem("ww_prefetch_queue");
    if (queue) {
      const queueArr = JSON.parse(queue);
      // Clear existing and restore (to avoid duplicates if called multiple times, though usually once)
      prefetchQueue.length = 0; 
      queueArr.forEach((item: string[]) => prefetchQueue.push(item));
    }
  } catch (e) {
    console.warn("Failed to load cache from storage", e);
  }
};

export default function LearningPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [storyData, setStoryData] = useState<StoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Quiz state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [isRecorded, setIsRecorded] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);

  // Use relative path '/api' which is proxied by Next.js to the backend
  // This works regardless of the external port (3000, 13900, etc.)
  const API_BASE = "/api";

  const sourceLevel = searchParams.get("sourceLevel") as keyof typeof vocabularyDict | null;
  const user = searchParams.get("user");

  // Restore cache on mount
  useEffect(() => {
    // Only load from storage if memory cache is empty (e.g. first load or refresh)
    // This prevents overwriting fresh in-memory state with stale storage data during client-side navigation
    if (prefetchQueue.length === 0 && storyCache.size === 0) {
      loadFromStorage();
    }
  }, []);

  const saveLearningRecord = async () => {
    if (isRecorded || !storyData || !user) return;

    try {
      const wordsList = Object.entries(storyData.translation_map).map(([word, meaning]) => ({
        word,
        meaning
      }));

      const res = await fetch(`${API_BASE}/record_learning`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_name: user,
          words: wordsList,
          source_level: sourceLevel || "Custom",
          topic: searchParams.get("topic") || "Daily Life",
        }),
      });

      if (res.ok) {
        setIsRecorded(true);
        console.log("Learning record saved");
      }
    } catch (err) {
      console.error("Failed to save learning record:", err);
    }
  };

  useEffect(() => {
    const fetchStory = async () => {
      const words = searchParams.getAll("words");
      const topic = searchParams.get("topic") || "Daily Life";
      
      const cacheKey = `${words.sort().join(',')}|${topic}`;

      // Reset states
      setLoading(true);
      setError("");
      setCurrentQuestionIndex(0);
      setSelectedOption(null);
      setIsAnswered(false);
      setScore(0);
      setQuizCompleted(false);
      setIsRecorded(false);
      setShowTranslation(false);
      
      // 1. Check Cache
      if (storyCache.has(cacheKey)) {
        console.log("Cache hit for:", cacheKey);
        setStoryData(storyCache.get(cacheKey)!);
        setLoading(false);
        return;
      }

      if (words.length === 0) {
        setError("未提供单词");
        setLoading(false);
        return;
      }

      // 2. Fetch if not in cache
      try {
        const query = new URLSearchParams();
        words.forEach((w) => query.append("words", w));
        query.set("topic", topic);
        // Use sourceLevel as the difficulty level if available, otherwise default to "Junior High"
        query.set("level", sourceLevel || "Junior High");

        console.log(`Fetching story from: ${API_BASE}/generate_story?${query.toString()}`);

        const res = await fetch(`${API_BASE}/generate_story?${query.toString()}`);
        if (!res.ok) {
            const errText = await res.text().catch(() => "No details");
            throw new Error(`生成故事失败 (${res.status}): ${errText.slice(0, 50)}`);
        }

        const data = await res.json();
        setStoryData(data);
        // Save to cache
        storyCache.set(cacheKey, data);
        saveToStorage(); // Persist after update
      } catch (err) {
        setError(err instanceof Error ? err.message : "出错了");
      } finally {
        setLoading(false);
      }
    };

    fetchStory();
  }, [searchParams]);

  // Prefetch logic
  useEffect(() => {
    if (!storyData || !sourceLevel) return;

    const prefetchNextStories = async () => {
      const topic = searchParams.get("topic") || "Daily Life";
      const currentVocabulary = vocabularyDict[sourceLevel];
      
      if (!currentVocabulary) return;
      
      // Calculate how many more we need
      // We consider both what's in the queue AND what's currently being fetched
      const activeCount = prefetchQueue.length + pendingKeys.size;
      const needed = 3 - activeCount;

      if (needed <= 0) return;

      console.log(`Starting prefetch for ${needed} stories. (Queue: ${prefetchQueue.length}, Pending: ${pendingKeys.size})`);

      for (let i = 0; i < needed; i++) {
        // Select random words
        let selected: string[] = [];
        let selectedStr = "";
        let attempts = 0;
        let valid = false;

        while (attempts < 10) {
            const shuffled = [...currentVocabulary].sort(() => 0.5 - Math.random());
            selected = shuffled.slice(0, 5);
            selectedStr = selected.sort().join(',');
            const cacheKey = `${selectedStr}|${topic}`;

            // Check if already in queue, pending, or cache
            const isDuplicate = 
                prefetchQueue.some(q => q.sort().join(',') === selectedStr) ||
                pendingKeys.has(cacheKey) ||
                storyCache.has(cacheKey);

            if (!isDuplicate) {
                valid = true;
                break;
            }
            attempts++;
        }

        if (!valid) continue;

        const cacheKey = `${selectedStr}|${topic}`;
        pendingKeys.add(cacheKey);

        // Fire and forget (parallel execution)
        (async () => {
            try {
                console.log("Prefetching start:", selected);
                const query = new URLSearchParams();
                selected.forEach((w) => query.append("words", w));
                query.set("topic", topic);
                query.set("level", sourceLevel || "Junior High");

                const res = await fetch(`${API_BASE}/generate_story?${query.toString()}`);
                if (res.ok) {
                    const data = await res.json();
                    storyCache.set(cacheKey, data);
                    prefetchQueue.push(selected);
                    saveToStorage(); // Persist after update
                    console.log("Prefetch success. Queue size:", prefetchQueue.length);
                }
            } catch (e) {
                console.error("Prefetch failed", e);
            } finally {
                pendingKeys.delete(cacheKey);
            }
        })();
      }
    };
    
    // Execute prefetch in background (low priority)
    const timeoutId = setTimeout(() => {
        prefetchNextStories();
    }, 1000); 

    return () => clearTimeout(timeoutId);
  }, [storyData, sourceLevel, searchParams]);

  const handleNextGroup = async () => {
    // Only save record if quiz completed with full score
    // If not completed or not perfect, we don't save (as per requirement)
    if (quizCompleted && storyData && score === storyData.quiz.length && !isRecorded) {
        await saveLearningRecord();
    }

    if (!sourceLevel || !vocabularyDict[sourceLevel]) return;

    let selected: string[] = [];
    
    // Try to get from queue
    if (prefetchQueue.length > 0) {
        selected = prefetchQueue.shift()!;
        saveToStorage(); // Persist the consumed state
        console.log("Using prefetched story:", selected);
    } else {
        // Fallback: Generate new random
        const vocabList = vocabularyDict[sourceLevel];
        const shuffled = [...vocabList].sort(() => 0.5 - Math.random());
        selected = shuffled.slice(0, 5);
        console.log("Queue empty, generating new:", selected);
    }
    
    const params = new URLSearchParams();
    selected.forEach(w => params.append("words", w));
    params.set("topic", searchParams.get("topic") || "Daily Life");
    if (sourceLevel) params.set("sourceLevel", sourceLevel);
    if (user) params.set("user", user);
    
    router.push(`/learning?${params.toString()}`);
  };

  const handleBackHome = () => {
    router.push("/");
  };

  const handleOptionSelect = (option: string) => {
    if (isAnswered) return;
    setSelectedOption(option);
  };

  const handleCheckAnswer = () => {
    if (!selectedOption || !storyData) return;
    
    const currentQuestion = storyData.quiz[currentQuestionIndex];
    const isCorrect = selectedOption === currentQuestion.answer;
    
    if (isCorrect) {
      setScore((prev) => prev + 1);
    }
    
    setIsAnswered(true);
  };

  const handleNextQuestion = () => {
    if (!storyData) return;

    if (currentQuestionIndex < storyData.quiz.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
      setSelectedOption(null);
      setIsAnswered(false);
    } else {
      setQuizCompleted(true);
      // Only save if score is perfect
      // score is updated in handleCheckAnswer, but here we are just finishing
      // Note: score update might be async but usually immediate in React 18 batching, 
      // but here we rely on current closure 'score'. 
      // Actually 'score' is state. 
      // We need to check if the LAST answer was correct too.
      // Wait, 'score' is incremented when 'Check Answer' is clicked.
      // 'Next Question' / 'View Results' is clicked AFTER check.
      // So 'score' should be up to date.
      
      if (score === storyData.quiz.length) {
          saveLearningRecord();
      }
    }
  };

  const handleRetryQuiz = () => {
    setCurrentQuestionIndex(0);
    setSelectedOption(null);
    setIsAnswered(false);
    setScore(0);
    setQuizCompleted(false);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-600" />
          <p className="text-gray-500">正在为你编织故事并生成测试题...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-red-50 text-red-600">
        错误: {error}
        <button onClick={handleBackHome} className="ml-4 underline">返回首页</button>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 flex-col">
      {/* Header Bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm z-10 shrink-0">
        <button 
          onClick={handleBackHome}
          className="flex items-center text-gray-600 hover:text-indigo-600 transition-colors font-medium text-sm"
        >
          <Home className="w-4 h-4 mr-2" />
          <span className="hidden sm:inline">返回首页</span>
        </button>

        <h1 className="text-lg font-bold text-gray-800 truncate px-2">WordWeaver</h1>

        {sourceLevel ? (
          <button 
            onClick={handleNextGroup}
            className="flex items-center text-indigo-600 hover:text-indigo-800 transition-colors font-medium text-sm bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 hover:bg-indigo-100 whitespace-nowrap"
          >
            <span className="hidden sm:inline">进入</span>下一组
            <FastForward className="w-4 h-4 ml-2" />
          </button>
        ) : (
          <div className="w-20"></div> // Spacer
        )}
      </div>

      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        {/* Left Panel: Story & Audio */}
        <div className="w-full md:w-1/2 p-4 md:p-6 flex flex-col space-y-4 border-b md:border-b-0 md:border-r border-gray-200 overflow-y-auto bg-white h-1/2 md:h-full">
          <div className="flex flex-col md:flex-row md:items-center justify-between shrink-0 gap-3 md:gap-0">
            <h2 className="text-xl md:text-2xl font-bold text-gray-800">你的故事</h2>
            {storyData && (
              <audio
                controls
                src={`${API_BASE}/audio?text=${encodeURIComponent(
                  storyData.content.replace(/\*\*/g, "")
                )}`}
                className="w-full md:w-80 h-10 md:h-12"
              />
            )}
          </div>

          <div className="prose prose-indigo max-w-none flex-1 text-sm md:text-base">
            <ReactMarkdown>{storyData?.content || ""}</ReactMarkdown>
          </div>

          {storyData?.translation && (
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mt-4 transition-all shrink-0">
              <button 
                onClick={() => setShowTranslation(!showTranslation)}
                className="w-full flex justify-between items-center mb-2 text-left group"
              >
                <h3 className="font-semibold text-gray-700 group-hover:text-indigo-600 transition-colors">中文翻译</h3>
                <div className="text-gray-400 group-hover:text-indigo-600 transition-colors">
                  {showTranslation ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </div>
              </button>
              
              {showTranslation && (
                <p className="text-gray-600 leading-relaxed text-sm animate-fade-in border-t border-gray-200 pt-2 mt-2">
                  {storyData.translation}
                </p>
              )}
            </div>
          )}

          <div className="bg-indigo-50 p-4 rounded-lg shrink-0">
            <h3 className="font-semibold text-indigo-900 mb-2">重点词汇</h3>
            <div className="grid grid-cols-2 gap-2">
              {storyData &&
                Object.entries(storyData.translation_map).map(([word, trans]) => (
                  <div key={word} className="flex justify-between text-sm">
                    <span className="font-medium text-indigo-700">{word}</span>
                    <span className="text-gray-600">{trans}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Right Panel: Interactive Quiz */}
        <div className="w-full md:w-1/2 flex flex-col bg-gray-50 h-1/2 md:h-full">
          <div className="p-4 md:p-6 border-b border-gray-200 bg-white shadow-sm shrink-0">
            <h2 className="text-lg md:text-xl font-bold text-gray-800 flex items-center gap-2">
              <Trophy className="text-yellow-500 w-5 h-5 md:w-6 md:h-6" />
              Interactive Quiz
            </h2>
            <p className="text-xs md:text-sm text-gray-500">
              Answer questions to master the vocabulary!
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col items-center justify-center">
            {storyData?.quiz && storyData.quiz.length > 0 ? (
              quizCompleted ? (
                <div className="text-center space-y-6 animate-fade-in">
                  <div className="bg-white p-8 rounded-2xl shadow-lg border border-indigo-100 max-w-md w-full">
                    <Trophy className="w-20 h-20 text-yellow-400 mx-auto mb-4" />
                    <h3 className="text-2xl font-bold text-gray-800 mb-2">
                      Quiz Completed!
                    </h3>
                    <p className="text-gray-600 mb-6">
                      You got <span className="text-indigo-600 font-bold text-xl">{score}</span> out of{" "}
                      <span className="font-bold">{storyData.quiz.length}</span> correct.
                    </p>
                    
                    <div className="space-y-3">
                      <button
                        onClick={handleRetryQuiz}
                        className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors font-medium"
                      >
                        <RefreshCcw size={18} />
                        Try Again
                      </button>
                      
                      {sourceLevel && (
                        <button
                          onClick={handleNextGroup}
                          className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-white border-2 border-indigo-100 text-indigo-600 rounded-xl hover:bg-indigo-50 transition-colors font-medium"
                        >
                          <FastForward size={18} />
                          Next Group
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-lg space-y-6">
                  <div className="flex justify-between items-center text-sm font-medium text-gray-500 mb-2">
                    <span>Question {currentQuestionIndex + 1} of {storyData.quiz.length}</span>
                    <span>Score: {score}</span>
                  </div>
                  
                  <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900 mb-6 leading-relaxed">
                      {storyData.quiz[currentQuestionIndex].question}
                    </h3>

                    <div className="space-y-3">
                      {storyData.quiz[currentQuestionIndex].options.map((option, idx) => {
                        const isSelected = selectedOption === option;
                        const isCorrect = option === storyData.quiz[currentQuestionIndex].answer;
                        
                        let buttonStyle = "border-gray-200 hover:border-indigo-300 hover:bg-indigo-50";
                        let icon = null;

                        if (isAnswered) {
                          if (isCorrect) {
                            buttonStyle = "bg-green-50 border-green-500 text-green-700";
                            icon = <CheckCircle className="w-5 h-5 text-green-600" />;
                          } else if (isSelected) {
                            buttonStyle = "bg-red-50 border-red-500 text-red-700";
                            icon = <XCircle className="w-5 h-5 text-red-600" />;
                          } else {
                            buttonStyle = "border-gray-200 opacity-50";
                          }
                        } else if (isSelected) {
                          buttonStyle = "border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600";
                        }

                        return (
                          <button
                            key={idx}
                            onClick={() => handleOptionSelect(option)}
                            disabled={isAnswered}
                            className={`w-full p-4 text-left rounded-xl border-2 transition-all flex items-center justify-between ${buttonStyle}`}
                          >
                            <span className="font-medium">{option}</span>
                            {icon}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex justify-end pt-4">
                    {!isAnswered ? (
                      <button
                        onClick={handleCheckAnswer}
                        disabled={!selectedOption}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-8 rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transform hover:-translate-y-0.5 active:translate-y-0"
                      >
                        Submit Answer
                      </button>
                    ) : (
                      <button
                        onClick={handleNextQuestion}
                        className="bg-gray-900 hover:bg-gray-800 text-white py-3 px-8 rounded-xl font-bold transition-all flex items-center gap-2 shadow-md hover:shadow-lg transform hover:-translate-y-0.5 active:translate-y-0"
                      >
                        {currentQuestionIndex < storyData.quiz.length - 1 ? (
                          <>
                            Next Question <ArrowRight size={18} />
                          </>
                        ) : (
                          <>
                            View Results <Trophy size={18} />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            ) : (
              <div className="text-center text-gray-500">
                <p>暂无测试题</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
