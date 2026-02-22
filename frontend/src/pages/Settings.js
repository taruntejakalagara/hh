import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Settings = () => {
  const { token, user } = useAuth();
  const [theme, setTheme] = useState('light');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Load current theme from user or localStorage
    const savedTheme = user?.theme || localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    applyTheme(savedTheme);
  }, [user]);

  const applyTheme = (newTheme) => {
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', newTheme);
  };

  const handleThemeChange = async (newTheme) => {
    setSaving(true);
    try {
      await axios.put(
        `${API}/users/theme`,
        { theme: newTheme },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setTheme(newTheme);
      applyTheme(newTheme);
    } catch (error) {
      console.error('Failed to update theme:', error);
      alert('Failed to update theme. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 transition-colors">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-gray-500 to-gray-600 rounded-xl flex items-center justify-center">
              <span className="text-xl">⚙️</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white" data-testid="settings-title">
                Settings
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">Customize your preferences</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* User Info Card */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 transition-colors">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Account Information</h2>
            <div className="space-y-3">
              <div className="flex justify-between py-2">
                <span className="text-gray-600 dark:text-gray-400">Username:</span>
                <span className="font-medium text-gray-900 dark:text-white">{user?.username}</span>
              </div>
              <div className="flex justify-between py-2 border-t border-gray-100 dark:border-gray-700">
                <span className="text-gray-600 dark:text-gray-400">Email:</span>
                <span className="font-medium text-gray-900 dark:text-white">{user?.email}</span>
              </div>
            </div>
          </div>

          {/* Theme Settings Card */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 transition-colors">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Appearance</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Choose how AI Guardian looks to you. Select a single theme, or sync with your system.
            </p>

            <div className="grid grid-cols-2 gap-4">
              {/* Light Mode */}
              <button
                onClick={() => handleThemeChange('light')}
                disabled={saving}
                className={`p-6 rounded-xl border-2 transition-all ${
                  theme === 'light'
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                data-testid="theme-light-button"
              >
                <div className="flex flex-col items-center space-y-3">
                  <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-400 rounded-full flex items-center justify-center text-3xl">
                    ☀️
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-gray-900 dark:text-white">Light Mode</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Bright and clean
                    </div>
                  </div>
                  {theme === 'light' && (
                    <div className="text-green-600 dark:text-green-400 font-medium text-sm">
                      ✓ Active
                    </div>
                  )}
                </div>
              </button>

              {/* Dark Mode */}
              <button
                onClick={() => handleThemeChange('dark')}
                disabled={saving}
                className={`p-6 rounded-xl border-2 transition-all ${
                  theme === 'dark'
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
                data-testid="theme-dark-button"
              >
                <div className="flex flex-col items-center space-y-3">
                  <div className="w-16 h-16 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-full flex items-center justify-center text-3xl">
                    🌙
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-gray-900 dark:text-white">Dark Mode</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Easy on the eyes
                    </div>
                  </div>
                  {theme === 'dark' && (
                    <div className="text-purple-600 dark:text-purple-400 font-medium text-sm">
                      ✓ Active
                    </div>
                  )}
                </div>
              </button>
            </div>

            {saving && (
              <div className="mt-4 text-center text-sm text-gray-600 dark:text-gray-400">
                Saving preference...
              </div>
            )}
          </div>

          {/* App Info Card */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 transition-colors">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">About AI Guardian</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center space-x-3 text-gray-600 dark:text-gray-400">
                <span>✓</span>
                <span>AI-powered nutrition tracking</span>
              </div>
              <div className="flex items-center space-x-3 text-gray-600 dark:text-gray-400">
                <span>✓</span>
                <span>Voice-guided cooking</span>
              </div>
              <div className="flex items-center space-x-3 text-gray-600 dark:text-gray-400">
                <span>✓</span>
                <span>Photo food recognition</span>
              </div>
              <div className="flex items-center space-x-3 text-gray-600 dark:text-gray-400">
                <span>✓</span>
                <span>Smart recipe transformation</span>
              </div>
              <div className="flex items-center space-x-3 text-gray-600 dark:text-gray-400">
                <span>✓</span>
                <span>Local store finder</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
