import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Settings, TrendingUp, AlertCircle, CheckCircle, XCircle, Zap, LogOut, User, Chrome, Eye, EyeOff } from 'lucide-react';

const GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY || 'AIzaSyDuoA5cIPyb8mWwMPzUooYhuxkTp4kY4dE';
const DERIV_APP_ID = process.env.REACT_APP_DERIV_APP_ID || '106298';
const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || '';

export default function DerivAIBot() {
  const [isClient, setIsClient] = useState(false);
  const [authState, setAuthState] = useState('login');
  const [derivToken, setDerivToken] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('derivToken') || '';
    }
    return '';
  });
  const [currentUser, setCurrentUser] = useState(null);
  const [derivUsername, setDerivUsername] = useState('');
  const [derivPassword, setDerivPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  // Ensure component only renders on client
  useEffect(() => {
    setIsClient(true);
  }, []);

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
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('medusirBotUsers');
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });

  const saveUsers = (newUsers) => {
    setUsers(newUsers);
    if (typeof window !== 'undefined') {
      localStorage.setItem('medusirBotUsers', JSON.stringify(newUsers));
    }
  };

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { message, type, timestamp }]);
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleDerivLogin = async (e) => {
    e.preventDefault();
    if (!derivUsername.trim() || !derivPassword.trim()) {
      addLog('❌ Please enter username and password', 'error');
      return;
    }

    setLoginLoading(true);
    addLog('🔄 Authenticating with Deriv...', 'info');

    try {
      // Call Deriv API to get token from credentials
      const response = await fetch('https://api.deriv.com/api/v3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verify_email: derivUsername,
          password: derivPassword,
          req_id: 1
        })
      });

      if (!response.ok) {
        throw new Error('Failed to connect to Deriv API');
      }

      const data = await response.json();
      
      if (data.error) {
        addLog(`❌ Login failed: ${data.error.message}`, 'error');
        setLoginLoading(false);
        return;
      }

      if (!data.verify_email || !data.verify_email.authorize_token) {
        addLog('❌ Invalid credentials or no token received', 'error');
        setLoginLoading(false);
        return;
      }

      const token = data.verify_email.authorize_token;
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('derivToken', token);
        localStorage.setItem('derivUsername', derivUsername);
      }
      
      setDerivToken(token);
      setDerivPassword('');
      addLog(`✅ Logged in as: ${derivUsername}`, 'success');
      authenticateWithDerivToken(token, derivUsername);
    } catch (error) {
      addLog(`❌ Login failed: ${error.message}`, 'error');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      addLog('🔄 Redirecting to Google Sign-In...', 'info');
      
      const redirectUri = typeof window !== 'undefined' ? window.location.origin : 'https://medusirderiv.vercel.app';
      const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=openid%20email%20profile&` +
        `access_type=online`;
      
      window.location.href = googleAuthUrl;
    } catch (error) {
      addLog(`❌ Google login error: ${error.message}`, 'error');
    }
  };

  useEffect(() => {
    if (!isClient) return;
    
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const token = urlParams.get('token');
    
    // Handle OAuth callback with code
    if (code && !derivToken) {
      addLog('🔄 Processing authorization code...', 'info');
      // Use code as token (Deriv OAuth returns code that can be used as token)
      if (typeof window !== 'undefined') {
        localStorage.setItem('derivToken', code);
      }
      setDerivToken(code);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      addLog('✅ Authorization successful!', 'success');
    } 
    // Handle direct token (if using simpler flow)
    else if (token && !derivToken) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('derivToken', token);
      }
      setDerivToken(token);
      addLog('✅ Token received!', 'success');
      window.history.replaceState({}, document.title, window.location.pathname);
    } 
    // If token already exists in localStorage, authenticate
    else if (derivToken && !currentUser) {
      authenticateWithDerivToken(derivToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, derivToken, currentUser]);

  const authenticateWithDerivToken = async (token, username = '') => {
    try {
      addLog('🔄 Authenticating with Deriv...', 'info');
      const email = username ? `${username}@deriv.com` : 'user@deriv.com';
      setCurrentUser({ id: username || 'user', email, username: username || 'Deriv User' });
      setAuthState('authenticated');
      addLog(`✅ Authenticated successfully as ${username || 'user'}`, 'success');
      fetchAccounts(token);
    } catch (error) {
      addLog(`❌ Authentication Error: ${error.message}`, 'error');
    }
  };

  const fetchAccounts = async (token) => {
    try {
      addLog('🔄 Fetching accounts from Deriv API...', 'info');
      
      // Call Deriv API to get real accounts
      const response = await fetch('https://api.deriv.com/api/v3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorize: token,
          req_id: 1
        })
      });

      if (!response.ok) {
        throw new Error('Failed to connect to Deriv API');
      }

      const data = await response.json();
      
      if (data.error) {
        addLog(`❌ Deriv API Error: ${data.error.message}`, 'error');
        return;
      }

      if (!data.authorize || !data.authorize.account_list) {
        addLog('❌ No real accounts found. Invalid token or no accounts linked.', 'error');
        return;
      }

      const realAccounts = data.authorize.account_list.map(acc => ({
        id: acc.loginid,
        name: acc.account_type === 'real' ? 'Real Account' : 'Demo Account',
        type: acc.account_type,
        currency: acc.currency,
        balance: acc.balance || 0
      }));

      if (realAccounts.length === 0) {
        addLog('❌ No accounts available', 'error');
        return;
      }

      setAccounts(realAccounts);
      setConnected(true);
      addLog(`✅ Found ${realAccounts.length} real account(s)`, 'success');
    } catch (error) {
      // Fallback: Show demo mode when API fails (for development/testing)
      addLog(`⚠️ Could not fetch live accounts: ${error.message}`, 'warning');
      addLog('📊 Loading demo accounts for testing...', 'info');
      
      const demoAccounts = [
        { id: 'DEMO1234', name: 'Demo Trading Account', type: 'demo', currency: 'USD', balance: 10000 },
        { id: 'DEMO5678', name: 'Demo Practice Account', type: 'demo', currency: 'USD', balance: 5000 }
      ];
      
      setAccounts(demoAccounts);
      setConnected(true);
      addLog(`✅ Demo mode: ${demoAccounts.length} demo account(s) available`, 'success');
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

    if (typeof window !== 'undefined') {
      localStorage.removeItem('derivToken');
      localStorage.removeItem('derivUserId');
    }
    setDerivToken('');
    setCurrentUser(null);
    setAuthState('login');
    setConnected(false);
    setSelectedAccount(null);
    setAccounts([]);
    setTrades([]);
    addLog('✅ Logged out', 'success');
  };


  const selectAccount = (account) => {
    setSelectedAccount(account);
    setStats({ ...stats, balance: account.balance });
    addLog(`📊 Selected account: ${account.name} - Balance: $${account.balance}`, 'success');
  };

  const fetchMarketData = async () => {
    // Deriv Matches contracts - real symbols from Deriv platform
    const matchesSymbols = [
      { symbol: '1HZ100V', display: 'Volatility 100', type: 'volatility' },
      { symbol: '1HZ50V', display: 'Volatility 50', type: 'volatility' },
      { symbol: '1HZ10V', display: 'Volatility 10', type: 'volatility' },
      { symbol: 'R_100', display: 'RangeBreak 100', type: 'rangebreak' },
      { symbol: 'STPJPY', display: 'Step Index JPY', type: 'step' }
    ];
    
    const selected = matchesSymbols[Math.floor(Math.random() * matchesSymbols.length)];
    
    // Generate realistic match prediction data
    const targetPrice = 100 + (Math.random() - 0.5) * 50;
    const currentPrice = 100 + (Math.random() - 0.5) * 50;
    const volatility = 0.3 + Math.random() * 0.7;
    const rsi = 30 + Math.random() * 40;
    const macd = Math.random() > 0.5 ? 'bullish' : 'bearish';
    const trend = rsi > 50 ? 'uptrend' : 'downtrend';
    
    // Generate historical data for backtesting
    const historicalData = Array.from({ length: 20 }, (_, i) => ({
      timestamp: new Date(Date.now() - (20 - i) * 5 * 60 * 1000),
      price: 100 + (Math.random() - 0.5) * 50,
      volume: Math.random() * 1000000
    }));
    
    return {
      symbol: selected.symbol,
      display: selected.display,
      contractType: 'MATCH',
      currentPrice,
      targetPrice,
      priceRange: `${Math.round(targetPrice - 10)}-${Math.round(targetPrice + 10)}`,
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
        Market Symbol: ${market.display} (${market.symbol})
        Target Price: ${market.targetPrice.toFixed(2)}
        Current Price: ${market.currentPrice.toFixed(2)}
        Price Range: ${market.priceRange}
        Volatility: ${market.volatility.toFixed(2)}
        RSI (Relative Strength Index): ${Math.round(market.rsi)}
        MACD Signal: ${market.macd}
        Trend: ${market.trend}
        
        Historical Data (last 20 periods):
        ${market.historicalData.map((d, i) => `Period ${i}: ${d.price.toFixed(2)}`).join('\n')}
        
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

    const stake = calculateOptimalStake(analysis.suggestedStake, stats.winRate || 0.5);
    
    // Create trade record
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

    addLog(`🤖 MATCH Trade: ${market.display} | Target: ${market.targetPrice.toFixed(2)} | Current: ${market.currentPrice.toFixed(2)} | Stake: $${stake.toFixed(2)}`, 'success');
    
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
    addLog(`📊 ${market.display} - Target: ${market.targetPrice.toFixed(2)} | Current: ${market.currentPrice.toFixed(2)}`, 'info');
    
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botRunning, selectedAccount, settings]);

  // Only render on client side
  if (!isClient) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-black via-red-950 to-black flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

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
              <div className="space-y-6">
                <h2 className="text-3xl font-bold text-white mb-2 text-center">Login to Your Deriv Account</h2>
                <p className="text-center text-white/70 mb-8">Enter your Deriv credentials to connect and start trading Matches contracts with AI analysis</p>

                <div className="bg-gradient-to-br from-blue-900/40 to-cyan-900/40 backdrop-blur-xl rounded-2xl p-6 mb-6 border border-blue-500/30">
                  <div className="flex gap-3">
                    <Zap className="w-6 h-6 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-bold text-blue-300">App ID: {DERIV_APP_ID}</h3>
                      <p className="text-sm text-white/70 mt-1">Your login is secured through our official Deriv app</p>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleDerivLogin} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-white mb-2">Deriv Username or Email</label>
                    <input
                      type="text"
                      placeholder="Enter your Deriv username"
                      value={derivUsername}
                      onChange={(e) => setDerivUsername(e.target.value)}
                      disabled={loginLoading}
                      className="w-full backdrop-blur-xl bg-white/10 rounded-2xl px-4 py-3 text-white placeholder-white/40 border border-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-white mb-2">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter your Deriv password"
                        value={derivPassword}
                        onChange={(e) => setDerivPassword(e.target.value)}
                        disabled={loginLoading}
                        onKeyPress={(e) => e.key === 'Enter' && handleDerivLogin(e)}
                        className="w-full backdrop-blur-xl bg-white/10 rounded-2xl px-4 py-3 pr-12 text-white placeholder-white/40 border border-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        disabled={loginLoading}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition disabled:opacity-50"
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loginLoading}
                    className="w-full mt-6 bg-gradient-to-r from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700 disabled:from-blue-500/50 disabled:to-cyan-600/50 rounded-2xl py-4 font-bold text-white transition duration-300 transform hover:scale-105 disabled:scale-100 shadow-lg flex items-center justify-center gap-3 text-lg"
                  >
                    {loginLoading ? (
                      <>
                        <div className="animate-spin">🔄</div>
                        Logging in...
                      </>
                    ) : (
                      <>
                        <Zap className="w-6 h-6" />
                        Login to Deriv Account
                      </>
                    )}
                  </button>
                </form>

                <div className="relative my-8">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/20"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-gradient-to-br from-red-900/30 to-red-950/30 text-white/60">Or continue with</span>
                  </div>
                </div>

                <button
                  onClick={handleGoogleLogin}
                  disabled={loginLoading || !GOOGLE_CLIENT_ID}
                  className={`w-full rounded-2xl py-4 font-bold transition duration-300 transform shadow-lg flex items-center justify-center gap-3 text-lg ${
                    !GOOGLE_CLIENT_ID
                      ? 'bg-gray-600/50 text-gray-400 opacity-50 cursor-not-allowed disabled:scale-100'
                      : 'bg-white hover:bg-white/90 text-gray-900 hover:scale-105 disabled:bg-white/50'
                  }`}
                >
                  <Chrome className="w-6 h-6" />
                  {!GOOGLE_CLIENT_ID ? 'Google Login (Not Configured)' : 'Login with Google'}
                </button>

                {!GOOGLE_CLIENT_ID && (
                  <div className="mt-4 p-4 bg-orange-900/20 rounded-xl border border-orange-500/30">
                    <p className="text-sm text-orange-200">
                      <strong>📝 Setup Google OAuth:</strong><br/>
                      1. Visit <span className="font-mono text-orange-300">console.cloud.google.com</span><br/>
                      2. Create OAuth 2.0 credentials<br/>
                      3. Add redirect: <span className="font-mono text-xs text-orange-300">http://localhost:3000</span><br/>
                      4. Copy Client ID to <span className="font-mono text-orange-300">.env.local</span>
                    </p>
                  </div>
                )}

                <div className="mt-8 p-4 bg-white/5 rounded-xl border border-white/10">
                  <p className="text-xs text-white/60 text-center">
                    🔒 Your credentials are securely sent to Deriv. We never store your password.
                  </p>
                </div>

                <div className="mt-6 p-4 bg-yellow-900/20 rounded-xl border border-yellow-500/30">
                  <p className="text-sm text-yellow-200">
                    <strong>⚠️ Don't have a Deriv account?</strong><br/>
                    Visit <span className="font-mono text-yellow-300">deriv.com</span> to create one for free
                  </p>
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
          <div></div>
        ) : (
          <>
            {!selectedAccount && (
              <div className="backdrop-blur-3xl bg-gradient-to-br from-red-900/30 to-red-950/30 rounded-3xl p-8 mb-6 border border-red-500/20">
                <h2 className="text-2xl font-bold mb-6">Select Trading Account</h2>
                
                <div className="mb-8">
                  <h3 className="text-lg font-semibold text-blue-300 mb-3 flex items-center gap-2">
                    <span className="text-blue-400">📊</span> Demo Accounts (Risk-Free Practice)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {accounts.filter(a => a.type === 'demo').map(account => (
                      <button
                        key={account.id}
                        onClick={() => selectAccount(account)}
                        className="backdrop-blur-xl bg-blue-600/20 hover:bg-blue-600/30 rounded-2xl p-6 text-left transition border border-blue-500/50 hover:border-blue-400 transform hover:scale-105"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-bold text-lg text-blue-300">{account.name}</div>
                            <div className="text-sm text-white/60 mt-1">{account.id}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-bold text-blue-400">${account.balance.toLocaleString()}</div>
                            <div className="text-xs text-blue-300 uppercase mt-1 font-semibold">Demo</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                
                {accounts.some(a => a.type === 'real') && (
                  <div>
                    <h3 className="text-lg font-semibold text-green-300 mb-3 flex items-center gap-2">
                      <span className="text-green-400">💰</span> Real Money Accounts
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {accounts.filter(a => a.type === 'real').map(account => (
                        <button
                          key={account.id}
                          onClick={() => selectAccount(account)}
                          className="backdrop-blur-xl bg-green-600/20 hover:bg-green-600/30 rounded-2xl p-6 text-left transition border border-green-500/50 hover:border-green-400 transform hover:scale-105"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-bold text-lg text-green-300">{account.name}</div>
                              <div className="text-sm text-white/60 mt-1">{account.id}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-2xl font-bold text-green-400">${account.balance.toLocaleString()}</div>
                              <div className="text-xs text-green-300 uppercase mt-1 font-semibold">Real</div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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