import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Health = () => {
  const { token } = useAuth();
  const [biometrics, setBiometrics] = useState([]);
  const [latestData, setLatestData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  
  // Manual entry state
  const [formData, setFormData] = useState({
    heart_rate: '',
    resting_heart_rate: '',
    hrv: '',
    sleep_hours: '',
    steps: '',
    active_calories: '',
    blood_oxygen: '',
    recovery_score: '',
    strain_score: '',
    sleep_performance: ''
  });

  useEffect(() => {
    loadBiometrics();
    loadLatestData();
  }, []);

  const loadBiometrics = async () => {
    try {
      const response = await axios.get(`${API}/biometrics`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBiometrics(response.data);
    } catch (error) {
      console.error('Failed to load biometrics:', error);
    }
  };

  const loadLatestData = async () => {
    try {
      const response = await axios.get(`${API}/biometrics/latest`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLatestData(response.data);
    } catch (error) {
      // No data yet, that's okay
      setLatestData(null);
    }
  };

  const handleManualEntry = async (e) => {
    e.preventDefault();
    setLoading(true);

    // Filter out empty values
    const dataToSubmit = Object.entries(formData).reduce((acc, [key, value]) => {
      if (value !== '' && value !== null) {
        acc[key] = parseFloat(value);
      }
      return acc;
    }, {});

    try {
      await axios.post(
        `${API}/biometrics/sync-wearable`,
        { ...dataToSubmit, source: 'manual' },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      alert('Biometric data logged successfully!');
      setFormData({
        heart_rate: '',
        resting_heart_rate: '',
        hrv: '',
        sleep_hours: '',
        steps: '',
        active_calories: '',
        blood_oxygen: '',
        recovery_score: '',
        strain_score: '',
        sleep_performance: ''
      });
      setShowManualEntry(false);
      await loadBiometrics();
      await loadLatestData();
    } catch (error) {
      console.error('Failed to log biometrics:', error);
      alert('Failed to log data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getSourceBadge = (source) => {
    const badges = {
      manual: { label: '✏️ Manual', color: 'gray' },
      whoop: { label: '⌚ WHOOP', color: 'purple' },
      apple_health: { label: ' Apple Watch', color: 'blue' },
      google_health: { label: '🏃 Google Fit', color: 'green' }
    };
    const badge = badges[source] || badges.manual;
    return (
      <span className={`text-xs px-2 py-1 rounded-full bg-${badge.color}-100 dark:bg-${badge.color}-900 text-${badge.color}-700 dark:text-${badge.color}-300`}>
        {badge.label}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-600 rounded-xl flex items-center justify-center">
                <span className="text-xl">❤️</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white" data-testid="health-title">
                  Health & Biometrics
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400">Track your health metrics</p>
              </div>
            </div>

            <button
              onClick={() => setShowManualEntry(!showManualEntry)}
              className="px-4 py-2 bg-gradient-to-r from-pink-500 to-rose-600 text-white rounded-lg font-semibold hover:from-pink-600 hover:to-rose-700"
              data-testid="add-biometric-button"
            >
              {showManualEntry ? '✕ Cancel' : '+ Add Entry'}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Note about mobile app */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
            <div className="flex items-start space-x-3">
              <span className="text-2xl">ℹ️</span>
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-1">Wearable Integration</h3>
                <p className="text-sm text-blue-700 dark:text-blue-400">
                  Apple HealthKit and Google Health Connect require a native mobile app. WHOOP API integration coming soon! For now, you can manually enter your biometric data.
                </p>
              </div>
            </div>
          </div>

          {/* Manual Entry Form */}
          {showManualEntry && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Manual Entry</h2>
              <form onSubmit={handleManualEntry} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* General Metrics */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Heart Rate (bpm)
                    </label>
                    <input
                      type="number"
                      value={formData.heart_rate}
                      onChange={(e) => setFormData({...formData, heart_rate: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                      placeholder="e.g., 72"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Resting Heart Rate (bpm)
                    </label>
                    <input
                      type="number"
                      value={formData.resting_heart_rate}
                      onChange={(e) => setFormData({...formData, resting_heart_rate: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                      placeholder="e.g., 60"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      HRV (ms)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.hrv}
                      onChange={(e) => setFormData({...formData, hrv: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                      placeholder="e.g., 65"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Sleep Hours
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.sleep_hours}
                      onChange={(e) => setFormData({...formData, sleep_hours: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                      placeholder="e.g., 7.5"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Steps
                    </label>
                    <input
                      type="number"
                      value={formData.steps}
                      onChange={(e) => setFormData({...formData, steps: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                      placeholder="e.g., 10000"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Active Calories
                    </label>
                    <input
                      type="number"
                      value={formData.active_calories}
                      onChange={(e) => setFormData({...formData, active_calories: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                      placeholder="e.g., 500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Blood Oxygen (%)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.blood_oxygen}
                      onChange={(e) => setFormData({...formData, blood_oxygen: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                      placeholder="e.g., 98"
                    />
                  </div>

                  {/* WHOOP Metrics */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Recovery Score (0-100)
                    </label>
                    <input
                      type="number"
                      value={formData.recovery_score}
                      onChange={(e) => setFormData({...formData, recovery_score: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                      placeholder="e.g., 75"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Strain Score (0-21)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.strain_score}
                      onChange={(e) => setFormData({...formData, strain_score: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                      placeholder="e.g., 12.5"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Sleep Performance (%)
                    </label>
                    <input
                      type="number"
                      value={formData.sleep_performance}
                      onChange={(e) => setFormData({...formData, sleep_performance: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                      placeholder="e.g., 85"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-pink-500 to-rose-600 text-white rounded-lg font-semibold hover:from-pink-600 hover:to-rose-700 disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save Biometric Data'}
                </button>
              </form>
            </div>
          )}

          {/* Latest Metrics Dashboard */}
          {latestData && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Latest Metrics</h2>
                {getSourceBadge(latestData.source)}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {latestData.heart_rate && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <div className="text-sm text-red-600 dark:text-red-400 mb-1">Heart Rate</div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">{latestData.heart_rate}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">bpm</div>
                  </div>
                )}
                
                {latestData.hrv && (
                  <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                    <div className="text-sm text-purple-600 dark:text-purple-400 mb-1">HRV</div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">{latestData.hrv}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">ms</div>
                  </div>
                )}

                {latestData.sleep_hours && (
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <div className="text-sm text-blue-600 dark:text-blue-400 mb-1">Sleep</div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">{latestData.sleep_hours}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">hours</div>
                  </div>
                )}

                {latestData.steps && (
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <div className="text-sm text-green-600 dark:text-green-400 mb-1">Steps</div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">{latestData.steps.toLocaleString()}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">steps</div>
                  </div>
                )}

                {latestData.recovery_score && (
                  <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                    <div className="text-sm text-yellow-600 dark:text-yellow-400 mb-1">Recovery</div>
                    <div className="text-2xl font-bold text-gray-900 dark:text-white">{latestData.recovery_score}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">/ 100</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* History */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">History</h2>
            
            {biometrics.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📊</div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No biometric data yet</h3>
                <p className="text-gray-600 dark:text-gray-400">Start tracking your health metrics</p>
              </div>
            ) : (
              <div className="space-y-3">
                {biometrics.map((bio) => (
                  <div
                    key={bio.id}
                    className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                  >
                    <div className="flex items-center space-x-4 flex-1">
                      <div>
                        {getSourceBadge(bio.source)}
                      </div>
                      <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        {bio.heart_rate && <span>❤️ {bio.heart_rate} bpm</span>}
                        {bio.hrv && <span>💫 {bio.hrv} ms HRV</span>}
                        {bio.sleep_hours && <span>😴 {bio.sleep_hours}h</span>}
                        {bio.steps && <span>👟 {bio.steps.toLocaleString()}</span>}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(bio.recorded_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Health;
