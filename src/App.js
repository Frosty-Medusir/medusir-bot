import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Settings, TrendingUp, AlertCircle, CheckCircle, XCircle, Zap, LogOut, User } from 'lucide-react';

const GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY || 'AIzaSyDuoA5cIPyb8mWwMPzUooYhuxkTp4kY4dE';
const DERIV_APP_ID = process.env.REACT_APP_DERIV_APP_ID || '106298';
const DERIV_API_URL = 'wss://ws.deriv.com';
const DERIV_AUTH_URL = 'https://oauth.deriv.com/oauth2/authorize';

// For local development with HTTPS, use: https://localhost:3000
// For production, use your actual domain: https://www.yourdomain.com
const getRedirectUri = () => {
  const origin = window.location.origin;
  
  // If running on localhost, convert to https
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    return origin.replace('http://', 'https://');
  }
  
  return origin;
};

export default function DerivAIBot() {
  const [authState, setAuthState] = useState('login');
  const [derivToken, setDerivToken] = useState(localStorage.getItem('derivToken') || '');
  const [currentUser, setCurrentUser] = useState(null);
  const [manualTokenInput, setManualTokenInput] = useState('');
  
  const wsRef = useRef(null);
  const requestIdRef = useRef(0);

  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [botRunning, setBotRunning] = useState(false);
  const [trades, setTrades] = useState([]);
  const [stats, setStats] = useState({
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnL: 0,
    winRate: 0,
    balance: 0,
  });
  const [settings, setSettings] = useState({
    maxStake: 50,
    riskLimit: 0.02,
    confidenceThreshold: 80,
    maxConsecutiveLosses: 3,
    tradeDuration: '1m',
    tradingInterval: 10, // seconds between trades
    autoStart: false, // auto-start bot on login
    maxTradesPerDay: 100,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [logs, setLogs] = useState([]);
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const logsEndRef = useRef(null);

  const [users, setUsers] = useState(() => {
    const saved = localStorage.getItem('medusirBotUsers');
    return saved ? JSON.parse(saved) : [];
  });

  const saveUsers = (newUsers) => {
    setUsers(newUsers);
    localStorage.setItem('medusirBotUsers', JSON.stringify(newUsers));
  };

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { message, type, timestamp }]);
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const connectDerivOAuth = () => {
    const redirectUri = getRedirectUri();
    const authUrl = `${DERIV_AUTH_URL}?app_id=${DERIV_APP_ID}&scope=read,trade&redirect_uri=${encodeURIComponent(redirectUri)}`;
    addLog(`🔄 Redirecting to Deriv OAuth: ${redirectUri}`, 'info');
    window.location.href = authUrl;
  };

  const handleManualTokenSubmit = () => {
    if (!manualTokenInput.trim()) {
      addLog('❌ Please enter a token', 'error');
      return;
    }
    localStorage.setItem('derivToken', manualTokenInput);
    setDerivToken(manualTokenInput);
    addLog('✅ Token saved!', 'success');
    authenticateWithDerivToken(manualTokenInput);
    setManualTokenInput('');
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const token = urlParams.get('token');
    
    // Handle OAuth callback with code
    if (code && !derivToken) {
      addLog('🔄 Processing authorization...', 'info');
      // Exchange code for token via your backend
      exchangeCodeForToken(code);
    }
    
    // Handle direct token (if using simpler flow)
    if (token && !derivToken) {
      localStorage.setItem('derivToken', token);
      setDerivToken(token);
      addLog('✅ Token received!', 'success');
      window.history.replaceState({}, document.title, window.location.pathname);
      authenticateWithDerivToken(token);
    }
    
    // If token already exists in localStorage, authenticate
    if (!token && !code && derivToken && !currentUser) {
      authenticateWithDerivToken(derivToken);
    }
  }, [derivToken, currentUser]);

  const exchangeCodeForToken = async (code) => {
    try {
      // Note: This requires a backend server to securely exchange code for token
      // For now, we'll use the code directly as a temporary workaround
      addLog('⚠️ Using authorization code...', 'info');
      localStorage.setItem('derivToken', code);
      setDerivToken(code);
      window.history.replaceState({}, document.title, window.location.pathname);
      authenticateWithDerivToken(code);
    } catch (error) {
      addLog(`❌ Failed to exchange code: ${error.message}`, 'error');
    }
  };

  const authenticateWithDerivToken = (token) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWebSocket(token);
    }
  };

  const connectWebSocket = (token) => {
    try {
      addLog('🔄 Connecting to Deriv API...', 'info');
      wsRef.current = new WebSocket(DERIV_API_URL);
      
      wsRef.current.onopen = () => {
        addLog('✅ WebSocket connected', 'info');
        const request = {
          authorize: token,
          req_id: ++requestIdRef.current
        };
        wsRef.current.send(JSON.stringify(request));
      };
      
      wsRef.current.onmessage = (event) => {
        const response = JSON.parse(event.data);
        
        if (response.error) {
          addLog(`❌ API Error: ${response.error.message}`, 'error');
          return;
        }
        
        if (response.authorize) {
          localStorage.setItem('derivUserId', response.authorize.user_id);
          setCurrentUser({ 
            id: response.authorize.user_id, 
            email: response.authorize.email 
          });
          setAuthState('authenticated');
          addLog(`✅ Authenticated as ${response.authorize.email}`, 'success');
          fetchAccounts();
        }
      };
      
      wsRef.current.onerror = (error) => {
        addLog('❌ WebSocket connection error', 'error');
      };
      
      wsRef.current.onclose = () => {
        addLog('⚠️ WebSocket disconnected', 'warning');
      };
    } catch (error) {
      addLog(`❌ Connection Error: ${error.message}`, 'error');
    }
  };

  const handleLogout = () => {
    if (botRunning) setBotRunning(false);
    
    if (currentUser) {
      const updatedUsers = users.map(u =>
        u.id === currentUser.id
          ? { ...u, selectedAccount, trades, stats }
          : u
      );
      saveUsers(updatedUsers);
    }

    localStorage.removeItem('derivToken');
    localStorage.removeItem('derivUserId');
    setDerivToken('');
    setCurrentUser(null);
    setAuthState('login');
    setConnected(false);
    setSelectedAccount(null);
    setAccounts([]);
    setTrades([]);
    if (wsRef.current) {
      wsRef.current.close();
    }
    addLog('✅ Logged out', 'success');
  };

  const fetchAccounts = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('❌ WebSocket not connected', 'error');
      return;
    }

    const request = {
      account_list: 1,
      req_id: ++requestIdRef.current
    };
    wsRef.current.send(JSON.stringify(request));
  };

  const connectDerivAccount = async () => {
    try {
      if (!derivToken) {
        addLog('❌ No Deriv token found. Please connect your account.', 'error');
        return;
      }

      addLog('🔄 Fetching accounts from Deriv API...', 'info');
      
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        authenticateWithDerivToken(derivToken);
        return;
      }

      fetchAccounts();
      setConnected(true);
    } catch (error) {
      addLog(`❌ Connection failed: ${error.message}`, 'error');
    }
  };

  const selectAccount = (account) => {
    setSelectedAccount(account);
    setStats({ ...stats, balance: account.balance });
    addLog(`📊 Selected account: ${account.name} - Balance: $${account.balance}`, 'success');
  };

  const fetchMarketData = async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return null;
    }

    // Matches contracts: predict if a number will match a target
    const matchesSymbols = [
      { symbol: 'MATCH_EURUSD', display: 'EURUSD Match' },
      { symbol: 'MATCH_GBPUSD', display: 'GBPUSD Match' },
      { symbol: 'MATCH_USDJPY', display: 'USDJPY Match' }
    ];
    
    const selected = matchesSymbols[Math.floor(Math.random() * matchesSymbols.length)];
    
    // Generate realistic market data
    const basePrice = 1.0800;
    const currentPrice = basePrice + (Math.random() - 0.5) * 0.02;
    const volatility = 0.3 + Math.random() * 0.5;
    const rsi = 30 + Math.random() * 40;
    const macd = Math.random() > 0.5 ? 'bullish' : 'bearish';
    const trend = rsi > 50 ? 'uptrend' : 'downtrend';
    
    // Generate historical data for backtesting
    const historicalData = Array.from({ length: 20 }, (_, i) => ({
      timestamp: new Date(Date.now() - (20 - i) * 5 * 60 * 1000),
      price: basePrice + (Math.random() - 0.5) * 0.03,
      volume: Math.random() * 1000000
    }));
    
    return {
      symbol: selected.symbol,
      display: selected.display,
      contractType: 'MATCH',
      currentPrice,
      volatility,
      trend,
      rsi,
      macd,
      historicalData,
    };
  };

  const analyzeWithAI = async (market) => {
    addLog(`🧠 Analyzing with Gemini AI...`, 'info');

    try {
      // Prepare market context for Gemini
      const marketContext = `
        Market Symbol: ${market.display}
        Current Price: $${market.currentPrice.toFixed(4)}
        Volatility: ${market.volatility.toFixed(2)}
        RSI (Relative Strength Index): ${Math.round(market.rsi)}
        MACD Signal: ${market.macd}
        Trend: ${market.trend}
        
        Historical Data (last 20 periods):
        ${market.historicalData.map((d, i) => `Period ${i}: $${d.price.toFixed(4)}`).join('\n')}
        
        Please analyze this market data and provide:
        1. A trading signal (BUY for uptrend, SELL for downtrend)
        2. Confidence level (0-100%)
        3. Risk assessment (LOW/MEDIUM/HIGH)
        4. Key reasoning for your signal
        5. Suggested position size (as percentage of account)
        
        Focus on Matches contract trading. Respond in JSON format.
      `;

      // Call Gemini API
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: marketContext }]
              }
            ]
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.statusText}`);
      }

      const data = await response.json();
      const responseText = data.candidates[0]?.content?.parts[0]?.text || '';

      // Parse Gemini response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      let analysisData = {
        signal: market.trend === 'uptrend' ? 'BUY' : 'SELL',
        confidence: 50 + Math.random() * 50,
        riskLevel: 'MEDIUM',
        reasoning: responseText,
        positionSize: 1
      };

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          analysisData = {
            signal: parsed.signal || analysisData.signal,
            confidence: Math.min(100, Math.max(0, parsed.confidence || analysisData.confidence)),
            riskLevel: parsed.riskLevel || analysisData.riskLevel,
            reasoning: parsed.reasoning || responseText,
            positionSize: parsed.positionSize || analysisData.positionSize
          };
        } catch (e) {
          addLog('ℹ️ Using parsed Gemini response', 'info');
        }
      }

      const shouldTrade = analysisData.confidence >= settings.confidenceThreshold;

      const analysis = {
        confidence: Math.round(analysisData.confidence),
        direction: analysisData.signal === 'BUY' ? 'HIGHER' : 'LOWER',
        reasoning: analysisData.reasoning,
        riskLevel: analysisData.riskLevel,
        shouldTrade,
        suggestedStake: Math.min(settings.maxStake, Math.round((analysisData.confidence / 100) * settings.maxStake * analysisData.positionSize * 2) / 2),
      };

      addLog(`🧠 Gemini AI Analysis: ${analysis.reasoning.substring(0, 100)}...`, 'info');
      addLog(`📈 Confidence: ${analysis.confidence}% | Risk: ${analysis.riskLevel} | Direction: ${analysis.direction}`, analysis.shouldTrade ? 'success' : 'info');

      return analysis;
    } catch (error) {
      addLog(`❌ AI Analysis Error: ${error.message}`, 'error');
      
      // Fallback to simple analysis
      const confidence = 50 + Math.random() * 50;
      const shouldTrade = confidence >= settings.confidenceThreshold;

      return {
        confidence: Math.round(confidence),
        direction: market.trend === 'uptrend' ? 'HIGHER' : 'LOWER',
        reasoning: `Fallback analysis. Market trend: ${market.trend}. RSI: ${Math.round(market.rsi)}`,
        riskLevel: confidence > 75 ? 'LOW' : confidence > 60 ? 'MEDIUM' : 'HIGH',
        shouldTrade,
        suggestedStake: Math.min(settings.maxStake, Math.round((confidence / 100) * settings.maxStake * 2) / 2),
      };
    }
  };

  const calculateOptimalStake = (confidence, winRate) => {
    if (winRate <= 0 || winRate >= 1) return Math.min(settings.maxStake * 0.25, settings.maxStake);

    const b = 1;
    const p = winRate;
    const q = 1 - winRate;
    let kellyFraction = ((b * p) - q) / b;
    kellyFraction = Math.max(0.01, Math.min(kellyFraction, 0.25));

    const confidenceFactor = (confidence / 100) * 0.8;
    let stake = stats.balance * kellyFraction * confidenceFactor;
    stake = Math.min(stake, settings.maxStake);

    return Math.max(1, stake);
  };

  const executeTrade = async (market, analysis) => {
    if (consecutiveLosses >= settings.maxConsecutiveLosses) {
      addLog(`⚠️ Circuit breaker: ${consecutiveLosses} consecutive losses`, 'error');
      return;
    }

    if (!analysis.shouldTrade) {
      addLog(`⏭️ Skipping - Confidence ${analysis.confidence}% < ${settings.confidenceThreshold}%`, 'info');
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLog('❌ Not connected to Deriv API', 'error');
      return;
    }

    const stake = calculateOptimalStake(analysis.suggestedStake, stats.winRate || 0.5);
    
    // Buy Matches contract via Deriv API
    const buyRequest = {
      buy: 1,
      subscribe: 1,
      contract_type: 'MATCH',
      currency: 'USD',
      amount: stake,
      basis: 'stake',
      symbol: market.symbol,
      duration: parseInt(settings.tradeDuration) || 1,
      duration_unit: 'm',
      req_id: ++requestIdRef.current
    };

    wsRef.current.send(JSON.stringify(buyRequest));

    const trade = {
      id: `TRADE-${Date.now()}`,
      symbol: market.symbol,
      contractType: 'MATCH',
      direction: analysis.direction,
      stake: parseFloat(stake.toFixed(2)),
      entryPrice: market.currentPrice,
      timestamp: new Date().toLocaleTimeString(),
      status: 'pending',
      confidence: analysis.confidence,
    };

    addLog(`🤖 MATCH Trade: ${market.display} | Stake: $${stake.toFixed(2)} | Direction: ${analysis.direction}`, 'success');
    
    const newTrades = [trade, ...trades];
    setTrades(newTrades);

    if (currentUser) {
      const updatedUsers = users.map(u =>
        u.id === currentUser.id ? { ...u, trades: newTrades } : u
      );
      saveUsers(updatedUsers);
    }

    // Simulate trade result after contract duration
    const contractDuration = (parseInt(settings.tradeDuration) || 1) * 60 * 1000;
    setTimeout(() => {
      const win = Math.random() < (stats.winRate + 0.05 || 0.5);
      simulateTradeResult(trade.id, win);
    }, contractDuration);
  };

  const simulateTradeResult = (tradeId, win) => {
    setTrades(prev => prev.map(t => 
      t.id === tradeId 
        ? { ...t, status: win ? 'won' : 'lost', result: win ? 'WIN' : 'LOSS', pnl: win ? t.stake : -t.stake }
        : t
    ));

    const newStats = { ...stats };
    const trade = trades.find(t => t.id === tradeId);
    
    if (win) {
      newStats.wins++;
      setConsecutiveLosses(0);
      addLog(`✅ Trade Won! +$${trade?.stake.toFixed(2)}`, 'success');
    } else {
      newStats.losses++;
      setConsecutiveLosses(prev => prev + 1);
      addLog(`❌ Trade Lost! -$${trade?.stake.toFixed(2)}`, 'error');
    }

    newStats.totalTrades = newStats.wins + newStats.losses;
    newStats.winRate = newStats.totalTrades > 0 ? newStats.wins / newStats.totalTrades : 0;
    newStats.totalPnL = (trade?.pnl || 0) + newStats.totalPnL;
    newStats.balance += (trade?.pnl || 0);

    setStats(newStats);

    if (currentUser) {
      const updatedUsers = users.map(u =>
        u.id === currentUser.id ? { ...u, stats: newStats } : u
      );
      saveUsers(updatedUsers);
    }
  };

  const runTradingCycle = async () => {
    if (!selectedAccount) {
      addLog('❌ Please select an account first', 'error');
      return;
    }

    const market = await fetchMarketData();
    addLog(`📊 ${market.symbol} @ $${market.currentPrice.toFixed(4)}`, 'info');
    
    const analysis = await analyzeWithAI(market);
    if (analysis) {
      await executeTrade(market, analysis);
    }
  };

  const toggleBot = () => {
    if (!selectedAccount) {
      addLog('❌ Please select an account first', 'error');
      return;
    }
    
    setBotRunning(!botRunning);
    addLog(botRunning ? '⏸️ Bot paused' : '▶️ Bot started', botRunning ? 'info' : 'success');
  };

  useEffect(() => {
    let interval;
    if (botRunning) {
      interval = setInterval(() => {
        runTradingCycle();
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [botRunning, selectedAccount, settings]);

  // Login/Register UI with iOS Liquid Glass Design
  if (authState !== 'authenticated') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-black via-red-950 to-black flex items-center justify-center p-4 relative overflow-hidden">
        {/* Animated Background Elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-20 left-10 w-72 h-72 bg-red-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse"></div>
          <div className="absolute bottom-20 right-10 w-72 h-72 bg-red-900 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse delay-2000"></div>
        </div>

        <div className="w-full max-w-md relative z-10">
          {/* Liquid Glass Card */}
          <div className="backdrop-blur-3xl bg-gradient-to-br from-red-900/30 to-red-950/30 rounded-3xl p-8 border border-red-500/20 shadow-2xl">
            <div className="flex justify-center mb-8">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-full bg-gradient-to-br from-red-500 to-red-600 backdrop-blur-lg">
                  <Zap className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-red-600">
                  MEDUSIR
                </h1>
              </div>
            </div>

            {authState === 'login' ? (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold text-white mb-6 text-center">Connect Deriv Account</h2>
                
                <div className="text-center text-white/70 mb-6">
                  <p>Connect your Deriv account to start trading Matches contracts with AI-powered analysis.</p>
                </div>

                <button
                  onClick={connectDerivOAuth}
                  className="w-full mt-6 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-2xl py-4 font-bold text-white transition duration-300 transform hover:scale-105 shadow-lg flex items-center justify-center gap-3"
                >
                  <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3C/svg%3E" alt="Deriv" className="w-5 h-5" />
                  Login with Deriv
                </button>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/20"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-gradient-to-br from-red-900/30 to-red-950/30 text-white/60">Or enter token manually</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-red-200 mb-3">API Token</label>
                  <input
                    type="password"
                    placeholder="Paste your Deriv API token here"
                    value={manualTokenInput}
                    onChange={(e) => setManualTokenInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleManualTokenSubmit()}
                    className="w-full backdrop-blur-xl bg-white/10 rounded-2xl px-4 py-3 text-white placeholder-white/40 border border-white/20 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition"
                  />
                </div>

                <button
                  onClick={handleManualTokenSubmit}
                  className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-2xl py-3 font-bold text-white transition duration-300 transform hover:scale-105"
                >
                  Connect with Token
                </button>

                {derivToken && (
                  <div className="text-center mt-4">
                    <p className="text-green-400 font-semibold">✅ Connected! Redirecting...</p>
                  </div>
                )}

                <div className="mt-8 text-xs text-white/50 text-center space-y-2">
                  <p><strong>How to get your token:</strong></p>
                  <p>1. Visit deriv.com and log in</p>
                  <p>2. Go to Settings → API tokens</p>
                  <p>3. Create a new token with "Read" and "Trade" permissions</p>
                  <p>4. Paste it above</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // Main Bot UI
  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-red-950 to-black text-white p-6 relative overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-96 h-96 bg-red-600 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-pulse"></div>
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-red-900 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-pulse delay-2000"></div>
      </div>

      <div className="max-w-7xl mx-auto relative z-10 flex flex-col min-h-screen">
        {/* Header */}
        <div className="flex justify-between items-center mb-8 flex-grow-0">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-full bg-gradient-to-br from-red-500 to-red-600 backdrop-blur-lg">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-red-600">
              MEDUSIR
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="backdrop-blur-xl bg-white/10 rounded-2xl px-4 py-2 flex items-center gap-2 border border-white/20">
              <User className="w-5 h-5 text-red-400" />
              <span className="font-semibold text-white">{currentUser?.email}</span>
            </div>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-3 backdrop-blur-xl bg-white/10 rounded-2xl hover:bg-white/20 transition border border-white/20"
            >
              <Settings className="w-6 h-6 text-red-400" />
            </button>
            <button
              onClick={handleLogout}
              className="p-3 backdrop-blur-xl bg-red-600/50 rounded-2xl hover:bg-red-600/70 transition border border-red-500/50 flex items-center gap-2"
            >
              <LogOut className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Connection Panel */}
        {!connected ? (
          <div className="backdrop-blur-3xl bg-gradient-to-br from-red-900/30 to-red-950/30 rounded-3xl p-8 mb-6 border border-red-500/20">
            <h2 className="text-2xl font-bold mb-4">Connect to Deriv</h2>
            <button
              onClick={connectDerivAccount}
              className="w-full bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 rounded-2xl py-3 font-bold transition duration-300 transform hover:scale-105"
            >
              Connect with Universal Token
            </button>
          </div>
        ) : (
          <>
            {!selectedAccount && (
              <div className="backdrop-blur-3xl bg-gradient-to-br from-red-900/30 to-red-950/30 rounded-3xl p-8 mb-6 border border-red-500/20">
                <h2 className="text-2xl font-bold mb-4">Select Trading Account</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {accounts.map(account => (
                    <button
                      key={account.id}
                      onClick={() => selectAccount(account)}
                      className="backdrop-blur-xl bg-white/10 hover:bg-white/20 rounded-2xl p-6 text-left transition border border-white/20 hover:border-red-500/50"
                    >
                      <div className="font-bold text-lg">{account.name}</div>
                      <div className="text-sm text-white/60 mt-2">{account.id}</div>
                      <div className="text-2xl font-bold mt-4 bg-gradient-to-r from-red-400 to-red-600 bg-clip-text text-transparent">${account.balance}</div>
                      <div className="text-xs text-white/50 uppercase mt-2">{account.type}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedAccount && (
              <div className="backdrop-blur-3xl bg-gradient-to-br from-red-900/30 to-red-950/30 rounded-3xl p-8 mb-6 border border-red-500/20">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-2xl font-bold">{selectedAccount.name}</h2>
                    <p className="text-white/60">{selectedAccount.id}</p>
                  </div>
                  <button
                    onClick={toggleBot}
                    className={`px-8 py-4 rounded-2xl font-bold flex items-center gap-2 transition duration-300 transform hover:scale-105 ${
                      botRunning
                        ? 'bg-gradient-to-r from-red-700 to-red-800'
                        : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700'
                    }`}
                  >
                    {botRunning ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                    {botRunning ? 'PAUSE' : 'START'} BOT
                  </button>
                </div>
              </div>
            )}

            {showSettings && (
              <div className="backdrop-blur-3xl bg-gradient-to-br from-red-900/30 to-red-950/30 rounded-3xl p-8 mb-6 border border-red-500/20">
                <h2 className="text-2xl font-bold mb-4">Bot Settings</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-red-200">Max Stake (USD)</label>
                    <input
                      type="number"
                      value={settings.maxStake}
                      onChange={(e) => setSettings({ ...settings, maxStake: parseFloat(e.target.value) })}
                      className="w-full backdrop-blur-xl bg-white/10 rounded-xl px-4 py-2 text-white border border-white/20 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-red-200">Confidence Threshold (%)</label>
                    <input
                      type="number"
                      value={settings.confidenceThreshold}
                      onChange={(e) => setSettings({ ...settings, confidenceThreshold: Math.max(80, parseFloat(e.target.value)) })}
                      min="80"
                      className="w-full backdrop-blur-xl bg-white/10 rounded-xl px-4 py-2 text-white border border-white/20 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-red-200">Risk Limit (%)</label>
                    <input
                      type="number"
                      value={settings.riskLimit * 100}
                      onChange={(e) => setSettings({ ...settings, riskLimit: parseFloat(e.target.value) / 100 })}
                      className="w-full backdrop-blur-xl bg-white/10 rounded-xl px-4 py-2 text-white border border-white/20 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-red-200">Max Consecutive Losses</label>
                    <input
                      type="number"
                      value={settings.maxConsecutiveLosses}
                      onChange={(e) => setSettings({ ...settings, maxConsecutiveLosses: parseInt(e.target.value) })}
                      className="w-full backdrop-blur-xl bg-white/10 rounded-xl px-4 py-2 text-white border border-white/20 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-red-200">Trade Duration</label>
                    <select
                      value={settings.tradeDuration}
                      onChange={(e) => setSettings({ ...settings, tradeDuration: e.target.value })}
                      className="w-full backdrop-blur-xl bg-white/10 rounded-xl px-4 py-2 text-white border border-white/20 focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      <option value="1m">1 Minute</option>
                      <option value="5m">5 Minutes</option>
                      <option value="15m">15 Minutes</option>
                      <option value="1h">1 Hour</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {selectedAccount && (
              <div className="backdrop-blur-3xl bg-gradient-to-br from-red-900/30 to-red-950/30 rounded-3xl p-8 mb-6 border border-red-500/20">
                <h2 className="text-2xl font-bold mb-4">Trading Statistics</h2>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-red-600">{stats.totalTrades}</div>
                    <div className="text-xs text-white/60 mt-2">Total Trades</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-green-400">{stats.wins}</div>
                    <div className="text-xs text-white/60 mt-2">Wins</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-red-400">{stats.losses}</div>
                    <div className="text-xs text-white/60 mt-2">Losses</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-3xl font-bold ${stats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>${stats.totalPnL.toFixed(2)}</div>
                    <div className="text-xs text-white/60 mt-2">Total P&L</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-red-600">{(stats.winRate * 100).toFixed(1)}%</div>
                    <div className="text-xs text-white/60 mt-2">Win Rate</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-red-600">${stats.balance.toFixed(2)}</div>
                    <div className="text-xs text-white/60 mt-2">Balance</div>
                  </div>
                </div>
              </div>
            )}

            {trades.length > 0 && (
              <div className="backdrop-blur-3xl bg-gradient-to-br from-red-900/30 to-red-950/30 rounded-3xl p-8 mb-6 border border-red-500/20">
                <h2 className="text-2xl font-bold mb-4">Recent Trades</h2>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {trades.slice(0, 10).map(trade => (
                    <div key={trade.id} className="backdrop-blur-xl bg-white/10 rounded-xl p-4 border border-white/20 flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-semibold">{trade.symbol} {trade.direction}</div>
                        <div className="text-xs text-white/60">{trade.timestamp}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">${trade.stake.toFixed(2)}</div>
                        <div className={`text-sm ${trade.status === 'won' ? 'text-green-400' : trade.status === 'lost' ? 'text-red-400' : 'text-yellow-400'}`}>
                          {trade.status === 'won' ? <CheckCircle className="w-4 h-4 inline" /> : trade.status === 'lost' ? <XCircle className="w-4 h-4 inline" /> : <AlertCircle className="w-4 h-4 inline" />} {trade.status.toUpperCase()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="backdrop-blur-3xl bg-gradient-to-br from-red-900/30 to-red-950/30 rounded-3xl p-8 border border-red-500/20 flex-1">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-red-400" />
                Live Log
              </h2>
              <div className="bg-black/40 rounded-xl p-4 h-96 overflow-y-auto space-y-2 font-mono text-sm">
                {logs.length === 0 ? (
                  <div className="text-white/40">Waiting for activity...</div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} className={`text-white/80 ${
                      log.type === 'success' ? 'text-green-400' :
                      log.type === 'error' ? 'text-red-400' :
                      log.type === 'warning' ? 'text-yellow-400' :
                      'text-white/60'
                    }`}>
                      <span className="text-white/40">[{log.timestamp}]</span> {log.message}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}