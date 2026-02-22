import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Chat = () => {
  const { token } = useAuth();
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(() => {
    return localStorage.getItem('voiceModeEnabled') === 'true';
  });
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    loadChatHistory();
    initializeSpeechRecognition();
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('voiceModeEnabled', voiceModeEnabled);
  }, [voiceModeEnabled]);

  const initializeSpeechRecognition = () => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInputMessage(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  };

  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (error) {
        console.error('Failed to start recognition:', error);
      }
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const speak = (text) => {
    if (!voiceModeEnabled) return;
    
    stopSpeaking();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    synthRef.current.speak(utterance);
  };

  const stopSpeaking = () => {
    if (synthRef.current.speaking) {
      synthRef.current.cancel();
      setIsSpeaking(false);
    }
  };

  const toggleVoiceMode = () => {
    const newValue = !voiceModeEnabled;
    setVoiceModeEnabled(newValue);
    if (!newValue) {
      stopSpeaking();
    }
  };

  const loadChatHistory = async () => {
    try {
      const response = await axios.get(`${API}/chat/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessages(response.data);
    } catch (error) {
      console.error('Failed to load chat history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || loading) return;

    const messageText = inputMessage;
    setInputMessage('');
    setLoading(true);
    stopSpeaking();

    try {
      const response = await axios.post(
        `${API}/chat/message`,
        { message: messageText },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const newMessages = [
        ...messages,
        response.data.user_message,
        response.data.assistant_message
      ];
      
      setMessages(newMessages);
      
      // Speak the AI response if voice mode is enabled
      if (voiceModeEnabled) {
        setTimeout(() => {
          speak(response.data.assistant_message.content);
        }, 500);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Failed to send message. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const quickCommands = [
    { text: 'What should I eat?', icon: '🍽️' },
    { text: 'Log my meal', icon: '📝' },
    { text: 'Start workout', icon: '💪' },
    { text: 'How much water today?', icon: '💧' }
  ];

  const handleQuickCommand = (command) => {
    setInputMessage(command);
  };

  if (loadingHistory) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
          <p className="mt-4 text-gray-600">Loading chat...</p>
        </div>
      </div>
    );
  }

  const supportsVoice = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                <span className="text-xl">🤖</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900" data-testid="chat-title">AI Guardian Chat</h1>
                <p className="text-sm text-gray-600">Your personal health assistant</p>
              </div>
            </div>

            {/* Voice Mode Toggle */}
            {supportsVoice && (
              <div className="flex items-center space-x-3">
                <button
                  onClick={toggleVoiceMode}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all ${
                    voiceModeEnabled
                      ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  data-testid="voice-mode-toggle"
                >
                  <span className="text-lg">🎤</span>
                  <span className="text-sm">Voice Mode</span>
                  {voiceModeEnabled && (
                    <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">ON</span>
                  )}
                </button>

                {isSpeaking && (
                  <button
                    onClick={stopSpeaking}
                    className="p-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg transition-colors"
                    data-testid="stop-speaking-button"
                  >
                    <span className="text-lg">⏹️</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-100 to-blue-200 rounded-full mb-4">
                <span className="text-4xl">💬</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Start a conversation</h3>
              <p className="text-gray-600 mb-6">Ask me anything about nutrition, meals, or health!</p>
              
              {supportsVoice && (
                <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg max-w-md mx-auto">
                  <div className="flex items-center justify-center space-x-2 text-purple-700">
                    <span className="text-2xl">🎤</span>
                    <span className="font-medium">Voice Mode Available!</span>
                  </div>
                  <p className="text-sm text-purple-600 mt-2">
                    Enable voice mode to speak your messages and hear AI responses
                  </p>
                </div>
              )}
              
              {/* Quick Command Suggestions */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl mx-auto">
                {quickCommands.map((cmd, index) => (
                  <button
                    key={index}
                    onClick={() => handleQuickCommand(cmd.text)}
                    className="p-4 bg-white rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-all group"
                    data-testid={`quick-command-${index}`}
                  >
                    <div className="text-2xl mb-2">{cmd.icon}</div>
                    <div className="text-sm font-medium text-gray-700 group-hover:text-green-700">{cmd.text}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              data-testid={`message-${message.role}`}
            >
              <div className={`flex items-start space-x-2 max-w-3xl ${message.role === 'user' ? 'flex-row-reverse space-x-reverse' : ''}`}>
                {/* Avatar */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${message.role === 'user' ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-blue-500 to-blue-600'}`}>
                  <span className="text-white text-sm">{message.role === 'user' ? '👤' : '🤖'}</span>
                </div>
                
                {/* Message Bubble */}
                <div className={`px-4 py-3 rounded-2xl ${message.role === 'user' ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-900'}`}>
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  <div className="flex items-center justify-between mt-1 space-x-3">
                    <span className={`text-xs ${message.role === 'user' ? 'text-green-100' : 'text-gray-500'}`}>
                      {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {message.role === 'assistant' && voiceModeEnabled && (
                      <button
                        onClick={() => speak(message.content)}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                        data-testid="replay-message-button"
                      >
                        🔊 Replay
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-start space-x-2 max-w-3xl">
                <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm">🤖</span>
                </div>
                <div className="px-4 py-3 bg-white border border-gray-200 rounded-2xl">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 px-4 py-4">
        <div className="max-w-4xl mx-auto">
          {/* Quick Commands */}
          {messages.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {quickCommands.map((cmd, index) => (
                <button
                  key={index}
                  onClick={() => handleQuickCommand(cmd.text)}
                  className="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full transition-colors"
                >
                  {cmd.icon} {cmd.text}
                </button>
              ))}
            </div>
          )}

          {/* Input Form */}
          <form onSubmit={sendMessage} className="flex space-x-3">
            {/* Microphone Button */}
            {supportsVoice && (
              <button
                type="button"
                onClick={isListening ? stopListening : startListening}
                className={`px-4 py-3 rounded-xl font-semibold transition-all ${
                  isListening
                    ? 'bg-gradient-to-r from-red-500 to-red-600 text-white animate-pulse'
                    : 'bg-gradient-to-r from-purple-500 to-purple-600 text-white hover:from-purple-600 hover:to-purple-700'
                }`}
                data-testid="mic-button"
              >
                {isListening ? '⏹️' : '🎤'}
              </button>
            )}

            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              disabled={loading || isListening}
              placeholder={isListening ? 'Listening...' : 'Ask me anything...'}
              className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent transition duration-200 disabled:bg-gray-100 disabled:cursor-not-allowed"
              data-testid="chat-input"
            />
            <button
              type="submit"
              disabled={loading || !inputMessage.trim() || isListening}
              className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-semibold hover:from-green-600 hover:to-emerald-700 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="chat-send-button"
            >
              {loading ? '...' : 'Send'}
            </button>
          </form>

          {/* Voice Status */}
          {isListening && (
            <div className="mt-3 text-center">
              <div className="inline-flex items-center space-x-2 px-4 py-2 bg-purple-50 border border-purple-200 rounded-lg text-purple-700">
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium">Listening... Speak now</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Chat;
