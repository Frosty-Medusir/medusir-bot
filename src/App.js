import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Settings, TrendingUp, Zap, LogOut, Eye, EyeOff, Key } from 'lucide-react';

// ✅ KEY INTEGRATED HERE
const GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY || 'AIzaSyDuoA5cIPyb8mWwMPzUooYhuxkTp4kY4dE';
const DERIV_APP_ID = process.env.REACT_APP_DERIV_APP_ID || '106298';

export default function DerivAIBot() {
  const [isClient, setIsClient] = useState(false);
  const [authState, setAuthState] = useState('login');
  
  // Login States
  const [derivToken, setDerivToken] = useState(() => {
    if (typeof window !== 'undefined') {
        return localStorage.getItem('derivToken') || '';
    }
    return '';
  });
  const [loginLoading, setLoginLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);
  
  // App States
  const [currentUser, setCurrentUser] = useState(null);
  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [botRunning, setBotRunning] = useState(false);
  
  // Trading Data
  const [trades, setTrades] = useState([]);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnL: 0,
    winRate: 0,
    balance: 0,
  });
  
  // Settings
  const [settings, setSettings] = useState({
    maxStake: 10, // Default stake
    riskLimit: 0.02,
    confidenceThreshold: 75, // Lowered slightly so you see trades faster in testing
    maxConsecutiveLosses: 3,
    tradeDuration: '1m',
  });
  const [showSettings, setShowSettings] = useState(false);
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  
  // Refs
  const logsEndRef = useRef(null);
  const wsRef = useRef(null); // Keep WebSocket reference

  // Initialize Client
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Helper: Add Log
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { message, type, timestamp }]);
    // Scroll to bottom
    setTimeout(() => {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  // --- WEBSOCKET CONNECTION & LOGIN LOGIC ---

  const connectToDeriv = useCallback((token) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
    }

    addLog('🔄 Connecting to Deriv WebSocket...', 'info');
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
    wsRef.current = ws;

    ws.onopen = () => {
      addLog('✅ Connected to Server. Authenticating...', 'info');
      ws.send(JSON.stringify({ authorize: token }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.error) {
        addLog(`❌ Deriv Error: ${data.error.message}`, 'error');
        setLoginLoading(false);
        if (data.error.code === 'InvalidToken') {
           setAuthState('login');
           localStorage.removeItem('derivToken');
        }
      } else if (data.msg_type === 'authorize') {
        // Login Successful
        setLoginLoading(false);
        setAuthState('authenticated');
        setCurrentUser({
          email: data.authorize.email,
          id: data.authorize.loginid,
          currency: data.authorize.currency,
          balance: data.authorize.balance
        });
        
        // Save token
        localStorage.setItem('derivToken', token);
        
        addLog(`✅ Logged in as ${data.authorize.email}`, 'success');
        
        // Setup Account
        const acc = {
            id: data.authorize.loginid,
            name: data.authorize.is_virtual ? 'Demo Account' : 'Real Account',
            type: data.authorize.is_virtual ? 'demo' : 'real',
            currency: data.authorize.currency,
            balance: Number(data.authorize.balance)
        };
        setAccounts([acc]);
        selectAccount(acc); // Auto select the authorized account
        setConnected(true);
      }
    };

    ws.onerror = (err) => {
      addLog('❌ WebSocket Error', 'error');
      setLoginLoading(false);
    };
    
    ws.onclose = () => {
        // Optional: Reconnect logic could go here
    };

  }, [addLog]);

  // Auto-login if token exists
  useEffect(() => {
      if (isClient && derivToken && authState === 'login') {
          // If we have a token saved, try to connect automatically
          // Uncomment next line to enable auto-login on refresh
          // connectToDeriv(derivToken); 
      }
  }, [isClient, derivToken, authState, connectToDeriv]);

  const handleDerivLogin = (e) => {
    e.preventDefault();
    if (!derivToken.trim()) {
      addLog('❌ Please enter your API Token', 'error');
      return;
    }
    setLoginLoading(true);
    connectToDeriv(derivToken);
  };

  const handleLogout = () => {
    setBotRunning(false);
    if(wsRef.current) wsRef.current.close();
    localStorage.removeItem('derivToken');
    setDerivToken('');
    setCurrentUser(null);
    setAuthState('login');
    setConnected(false);
    setTrades([]);
    addLog('✅ Logged out', 'success');
  };

  const selectAccount = (account) => {
    setSelectedAccount(account);
    setStats(prev => ({ ...prev, balance: account.balance }));
    addLog(`📊 Selected account: ${account.name} (${account.currency})`, 'success');
  };

  // --- GEMINI AI INTEGRATION ---

  const analyzeWithAI = async (market) => {
    if (!GEMINI_API_KEY) {
        addLog('❌ Gemini API Key is missing!', 'error');
        return null;
    }

    addLog(`🧠 Sending market data to Gemini...`, 'info');

    try {
      // 1. Construct the prompt
      const prompt = `
        Act as an expert financial analyst. Analyze this market data for a "Matches" or "Differs" trade contract on Volatility Indices.
        
        Market Data:
        Symbol: ${market.symbol}
        Current Price: ${market.currentPrice.toFixed(4)}
        Target Price: ${market.targetPrice.toFixed(4)}
        RSI: ${market.rsi.toFixed(2)}
        Trend: ${market.trend}
        Volatility: ${market.volatility.toFixed(4)}
        
        Task:
        Predict if the market is favorable for a trade.
        Return strictly valid JSON.
        
        JSON Schema:
        {
          "signal": "BUY" or "SELL",
          "confidence": number (integer 0-100),
          "riskLevel": "LOW" or "MEDIUM" or "HIGH",
          "reasoning": "short string explaining why (max 10 words)"
        }
      `;

      // 2. Call Gemini API
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                response_mime_type: "application/json" // Force JSON response
            }
          })
        }
      );

      if (!response.ok) throw new Error(`API Error: ${response.statusText}`);

      const data = await response.json();
      const responseText = data.candidates[0]?.content?.parts[0]?.text;
      
      // 3. Clean and Parse JSON
      let analysisData;
      try {
        // Remove markdown code blocks if present (just in case)
        const cleanJson = responseText.replace(/```json|```/g, '').trim();
        analysisData = JSON.parse(cleanJson);
      } catch (e) {
        console.error("JSON Parse Error", e);
        throw new Error("Failed to parse AI response");
      }

      const shouldTrade = analysisData.confidence >= settings.confidenceThreshold;

      const analysis = {
        confidence: analysisData.confidence,
        direction: analysisData.signal === 'BUY' ? 'HIGHER' : 'LOWER',
        reasoning: analysisData.reasoning,
        riskLevel: analysisData.riskLevel,
        shouldTrade,
        suggestedStake: settings.maxStake, 
      };

      addLog(`🧠 AI: ${analysis.reasoning}`, 'info');
      addLog(`📈 Conf: ${analysis.confidence}% | Risk: ${analysis.riskLevel}`, analysis.shouldTrade ? 'success' : 'warning');

      return analysis;

    } catch (error) {
      addLog(`❌ AI Error: ${error.message}`, 'error');
      // Fallback safe mode
      return {
          confidence: 0,
          shouldTrade: false,
          direction: 'N/A',
          reasoning: 'AI Connection Failed',
          riskLevel: 'HIGH'
      };
    }
  };

  // --- TRADING LOGIC ---

  const fetchMarketData = async () => {
    // NOTE: In production, subscribe to ticks via WebSocket
    // Simulating market movement for the demo
    const currentPrice = 1000 + Math.random() * 50;
    
    return {
      symbol: 'Volatility 100 (1s)',
      display: 'Volt 100',
      currentPrice: currentPrice,
      targetPrice: currentPrice + (Math.random() > 0.5 ? 1 : -1),
      volatility: 0.5 + Math.random(),
      trend: Math.random() > 0.5 ? 'uptrend' : 'downtrend',
      rsi: 30 + Math.random() * 40,
    };
  };

  const executeTrade = async (market, analysis) => {
    if (consecutiveLosses >= settings.maxConsecutiveLosses) {
      addLog(`⚠️ Max consecutive losses reached. Pausing.`, 'error');
      setBotRunning(false);
      return;
    }

    if (!analysis.shouldTrade) {
      addLog(`⏭️ Skipping. Confidence ${analysis.confidence}% < ${settings.confidenceThreshold}%`, 'info');
      return;
    }

    // 1. Register Trade in UI
    const tradeId = `T-${Date.now()}`;
    const newTrade = {
      id: tradeId,
      symbol: market.symbol,
      direction: analysis.direction,
      stake: settings.maxStake,
      timestamp: new Date().toLocaleTimeString(),
      status: 'pending',
      confidence: analysis.confidence
    };

    setTrades(prev => [newTrade, ...prev]);
    addLog(`🚀 Executing Trade: ${analysis.direction} on ${market.display}`, 'success');

    // 2. Simulate Result (Since we can't do real trades without a complex proposal flow)
    // In a real app, this would be ws.send({ buy: proposal_id })
    const randomDuration = Math.random() * 2000 + 2000; // 2-4 seconds
    setTimeout(() => {
        const isWin = Math.random() > 0.45; // Simulated win chance
        const profit = isWin ? settings.maxStake * 0.95 : -settings.maxStake;
        
        setTrades(prev => prev.map(t => 
            t.id === tradeId ? { ...t, status: isWin ? 'won' : 'lost', pnl: profit } : t
        ));

        setStats(prev => {
            const newBalance = prev.balance + profit;
            const newWins = prev.wins + (isWin ? 1 : 0);
            const newLosses = prev.losses + (isWin ? 0 : 1);
            const total = newWins + newLosses;
            
            // Update real balance in memory
            if(selectedAccount) {
                selectedAccount.balance = newBalance;
            }

            return {
                ...prev,
                wins: newWins,
                losses: newLosses,
                totalTrades: total,
                winRate: total > 0 ? newWins/total : 0,
                totalPnL: prev.totalPnL + profit,
                balance: newBalance
            };
        });

        if (!isWin) setConsecutiveLosses(prev => prev + 1);
        else setConsecutiveLosses(0);
        
        addLog(isWin ? `✅ WIN: +$${profit.toFixed(2)}` : `❌ LOSS: -$${Math.abs(profit).toFixed(2)}`, isWin ? 'success' : 'error');

    }, randomDuration);
  };

  const runTradingCycle = useCallback(async () => {
    if (!selectedAccount || !botRunning) return;
    const market = await fetchMarketData();
    const analysis = await analyzeWithAI(market);
    if (analysis) await executeTrade(market, analysis);
  }, [selectedAccount, botRunning]);

  // Bot Loop
  useEffect(() => {
    let interval;
    if (botRunning && connected) {
      // Run immediately on start
      runTradingCycle();
      // Then loop
      interval = setInterval(() => {
        runTradingCycle();
      }, 8000); // 8 seconds between cycles to allow Gemini to respond
    }
    return () => clearInterval(interval);
  }, [botRunning, connected, runTradingCycle, settings]);

  // --- RENDER ---

  if (!isClient) return <div className="min-h-screen bg-black text-white flex items-center justify-center">Loading...</div>;

  // Login Screen
  if (authState !== 'authenticated') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-black via-red-950 to-black flex items-center justify-center p-4 relative">
        <div className="w-full max-w-md backdrop-blur-3xl bg-white/5 rounded-3xl p-8 border border-red-500/20 shadow-2xl relative z-10">
          <div className="flex flex-col items-center mb-8">
            <div className="p-4 rounded-full bg-gradient-to-br from-red-500 to-red-600 mb-4 shadow-lg shadow-red-500/30">
              <Zap className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white">MEDUSIR AI</h1>
            <p className="text-white/60 text-sm mt-2">Deriv Automated Trading Bot</p>
          </div>

          <form onSubmit={handleDerivLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-white mb-2 ml-1">Deriv API Token</label>
              <div className="relative group">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-blue-400 transition" size={18} />
                <input
                  type={showToken ? 'text' : 'password'}
                  placeholder="Paste your API Token here"
                  value={derivToken}
                  onChange={(e) => setDerivToken(e.target.value)}
                  className="w-full bg-black/40 rounded-xl py-4 pl-10 pr-12 text-white placeholder-white/20 border border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                >
                  {showToken ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="text-xs text-white/40 mt-2 ml-1">
                Get this from Deriv Settings &gt; API Token &gt; Select "Read" and "Trade".
              </p>
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold py-4 rounded-xl transition duration-300 shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2 mt-4"
            >
              {loginLoading ? 'Authenticating...' : 'Connect to Deriv'}
            </button>
          </form>
          
          <div className="mt-6 border-t border-white/10 pt-4 text-center">
            <p className="text-xs text-white/30">Not affiliated with Deriv. Use at your own risk.</p>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard
  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white/5 rounded-2xl p-4 border border-white/10">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-red-600 to-orange-600 flex items-center justify-center font-bold">M</div>
                <div>
                    <h1 className="text-xl font-bold">MEDUSIR DASHBOARD</h1>
                    <div className="flex items-center gap-2 text-xs text-green-400">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        WebSocket Connected
                    </div>
                </div>
            </div>
            
            <div className="flex items-center gap-3">
                <div className="bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-right">
                    <div className="text-xs text-white/60">Balance</div>
                    <div className="font-mono font-bold text-lg text-green-400">
                        {selectedAccount ? `${selectedAccount.balance.toFixed(2)} ${selectedAccount.currency}` : '---'}
                    </div>
                </div>
                <button onClick={() => setShowSettings(!showSettings)} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10">
                    <Settings className="w-5 h-5" />
                </button>
                <button onClick={handleLogout} className="p-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500">
                    <LogOut className="w-5 h-5" />
                </button>
            </div>
        </header>

        {/* Main Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left: Stats & Controls */}
            <div className="space-y-6">
                <div className="bg-gradient-to-br from-gray-900 to-black rounded-3xl p-6 border border-white/10 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-red-600/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
                    
                    <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <TrendingUp className="text-blue-500" size={20} /> Performance
                    </h2>
                    
                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="bg-white/5 rounded-xl p-4 text-center">
                            <div className="text-2xl font-bold text-green-400">{stats.wins}</div>
                            <div className="text-xs text-white/50 uppercase">Wins</div>
                        </div>
                        <div className="bg-white/5 rounded-xl p-4 text-center">
                            <div className="text-2xl font-bold text-red-400">{stats.losses}</div>
                            <div className="text-xs text-white/50 uppercase">Losses</div>
                        </div>
                        <div className="bg-white/5 rounded-xl p-4 text-center col-span-2">
                            <div className={`text-3xl font-bold ${stats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toFixed(2)}
                            </div>
                            <div className="text-xs text-white/50 uppercase">Total Profit/Loss</div>
                        </div>
                    </div>

                    <button
                        onClick={() => setBotRunning(!botRunning)}
                        className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition duration-200 ${
                            botRunning 
                            ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30 border border-red-500/50' 
                            : 'bg-green-500 hover:bg-green-400 text-black border border-green-400'
                        }`}
                    >
                        {botRunning ? <><Pause size={20} /> STOP BOT</> : <><Play size={20} /> START TRADING</>}
                    </button>
                </div>

                {showSettings && (
                    <div className="bg-gray-900 rounded-3xl p-6 border border-white/10 animate-in slide-in-from-top-4">
                        <h3 className="font-bold mb-4 text-white/80">Bot Configuration</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-white/60">Stake Amount ($)</label>
                                <input 
                                    type="number" 
                                    value={settings.maxStake} 
                                    onChange={e => setSettings({...settings, maxStake: parseFloat(e.target.value)})}
                                    className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 mt-1 text-white" 
                                />
                            </div>
                            <div>
                                <label className="text-xs text-white/60">Confidence Threshold (%)</label>
                                <input 
                                    type="number" 
                                    value={settings.confidenceThreshold} 
                                    onChange={e => setSettings({...settings, confidenceThreshold: parseFloat(e.target.value)})}
                                    className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 mt-1 text-white" 
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Middle: Live Logs */}
            <div className="lg:col-span-2 flex flex-col gap-6">
                <div className="flex-1 bg-black/30 rounded-3xl border border-white/10 p-6 flex flex-col h-[500px]">
                    <h2 className="text-lg font-bold mb-4 flex items-center justify-between">
                        <span className="flex items-center gap-2"><Zap className="text-yellow-500" size={20} /> Live Activity</span>
                        <span className="text-xs font-mono bg-white/10 px-2 py-1 rounded text-white/50">LOGS</span>
                    </h2>
                    
                    <div className="flex-1 overflow-y-auto space-y-2 font-mono text-sm scrollbar-thin scrollbar-thumb-white/10 pr-2">
                        {logs.length === 0 && <div className="text-white/20 text-center mt-20">System ready. Waiting for commands...</div>}
                        {logs.map((log, idx) => (
                            <div key={idx} className={`p-2 rounded border-l-2 ${
                                log.type === 'success' ? 'border-green-500 bg-green-500/5 text-green-200' :
                                log.type === 'error' ? 'border-red-500 bg-red-500/5 text-red-200' :
                                'border-blue-500 bg-blue-500/5 text-blue-200'
                            }`}>
                                <span className="opacity-40 text-xs mr-2">[{log.timestamp}]</span>
                                {log.message}
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                </div>

                {/* Recent Trades Table */}
                <div className="bg-white/5 rounded-2xl border border-white/10 p-4">
                     <h3 className="text-sm font-bold mb-3 text-white/70">Recent Trades</h3>
                     <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-white/40 uppercase bg-white/5">
                                <tr>
                                    <th className="px-3 py-2 rounded-l-lg">Time</th>
                                    <th className="px-3 py-2">Symbol</th>
                                    <th className="px-3 py-2">Type</th>
                                    <th className="px-3 py-2">Stake</th>
                                    <th className="px-3 py-2 rounded-r-lg">Result</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trades.slice(0,5).map(trade => (
                                    <tr key={trade.id} className="border-b border-white/5">
                                        <td className="px-3 py-2 font-mono text-white/60">{trade.timestamp}</td>
                                        <td className="px-3 py-2">{trade.symbol}</td>
                                        <td className="px-3 py-2 font-bold">{trade.direction}</td>
                                        <td className="px-3 py-2">${trade.stake}</td>
                                        <td className="px-3 py-2">
                                            {trade.status === 'pending' ? <span className="text-yellow-500">Processing</span> : 
                                             trade.status === 'won' ? <span className="text-green-500 font-bold">WIN</span> : 
                                             <span className="text-red-500 font-bold">LOSS</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                     </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}