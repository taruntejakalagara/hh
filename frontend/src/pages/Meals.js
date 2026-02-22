import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Meals = () => {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState('scan'); // scan, log, history
  const [meals, setMeals] = useState([]);
  const [todayStats, setTodayStats] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Photo recognition state
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [recognizing, setRecognizing] = useState(false);
  const [recognitionResult, setRecognitionResult] = useState(null);
  
  // Manual logging state
  const [foodName, setFoodName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [servingSize, setServingSize] = useState('');
  
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadMeals();
    loadTodayStats();
  }, []);

  const loadMeals = async () => {
    try {
      const response = await axios.get(`${API}/meals`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMeals(response.data);
    } catch (error) {
      console.error('Failed to load meals:', error);
    }
  };

  const loadTodayStats = async () => {
    try {
      const response = await axios.get(`${API}/meals/stats/today`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTodayStats(response.data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
      setRecognitionResult(null);
    }
  };

  const recognizeFood = async () => {
    if (!selectedImage) return;

    setRecognizing(true);
    const formData = new FormData();
    formData.append('file', selectedImage);

    try {
      const response = await axios.post(`${API}/meals/recognize`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });
      setRecognitionResult(response.data);
    } catch (error) {
      console.error('Failed to recognize food:', error);
      alert('Failed to recognize food. Please try again.');
    } finally {
      setRecognizing(false);
    }
  };

  const logMealFromRecognition = async () => {
    if (!recognitionResult) return;

    setLoading(true);
    try {
      await axios.post(
        `${API}/meals`,
        {
          food_name: recognitionResult.food_name,
          calories: recognitionResult.calories,
          protein: recognitionResult.protein,
          carbs: recognitionResult.carbs,
          fat: recognitionResult.fat,
          serving_size: recognitionResult.serving_size,
          source: 'photo'
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      alert('Meal logged successfully!');
      setSelectedImage(null);
      setImagePreview(null);
      setRecognitionResult(null);
      await loadMeals();
      await loadTodayStats();
      setActiveTab('history');
    } catch (error) {
      console.error('Failed to log meal:', error);
      alert('Failed to log meal. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const logManualMeal = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await axios.post(
        `${API}/meals`,
        {
          food_name: foodName,
          calories: parseFloat(calories),
          protein: parseFloat(protein),
          carbs: parseFloat(carbs),
          fat: parseFloat(fat),
          serving_size: servingSize,
          source: 'manual'
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      alert('Meal logged successfully!');
      setFoodName('');
      setCalories('');
      setProtein('');
      setCarbs('');
      setFat('');
      setServingSize('');
      await loadMeals();
      await loadTodayStats();
      setActiveTab('history');
    } catch (error) {
      console.error('Failed to log meal:', error);
      alert('Failed to log meal. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const deleteMeal = async (mealId) => {
    if (!window.confirm('Are you sure you want to delete this meal?')) return;

    try {
      await axios.delete(`${API}/meals/${mealId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      await loadMeals();
      await loadTodayStats();
    } catch (error) {
      console.error('Failed to delete meal:', error);
      alert('Failed to delete meal. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center">
              <span className="text-xl">🍽️</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900" data-testid="meals-title">Meal Tracker</h1>
              <p className="text-sm text-gray-600">Log meals and track nutrition</p>
            </div>
          </div>
        </div>
      </div>

      {/* Today's Stats */}
      {todayStats && (
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-6 py-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-lg font-semibold mb-4">Today's Totals</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                <div className="text-2xl font-bold">{Math.round(todayStats.total_calories)}</div>
                <div className="text-sm opacity-90">Calories</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                <div className="text-2xl font-bold">{Math.round(todayStats.total_protein)}g</div>
                <div className="text-sm opacity-90">Protein</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                <div className="text-2xl font-bold">{Math.round(todayStats.total_carbs)}g</div>
                <div className="text-sm opacity-90">Carbs</div>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                <div className="text-2xl font-bold">{Math.round(todayStats.total_fat)}g</div>
                <div className="text-sm opacity-90">Fat</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex space-x-6">
            {[
              { id: 'scan', label: 'Scan Food', icon: '📸' },
              { id: 'log', label: 'Log Manually', icon: '📝' },
              { id: 'history', label: 'History', icon: '📊' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-orange-500 text-orange-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
                data-testid={`tab-${tab.id}`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Scan Food Tab */}
          {activeTab === 'scan' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Take a Photo or Upload Image</h3>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                  capture="environment"
                />

                {!imagePreview ? (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full py-12 border-2 border-dashed border-gray-300 rounded-xl hover:border-orange-400 hover:bg-orange-50 transition-colors group"
                    data-testid="upload-photo-button"
                  >
                    <div className="text-center">
                      <div className="text-6xl mb-4 group-hover:scale-110 transition-transform">📸</div>
                      <div className="text-lg font-medium text-gray-700 mb-2">Take Photo or Upload</div>
                      <div className="text-sm text-gray-500">Click to select an image</div>
                    </div>
                  </button>
                ) : (
                  <div className="space-y-4">
                    <div className="relative">
                      <img
                        src={imagePreview}
                        alt="Food preview"
                        className="w-full h-64 object-cover rounded-lg"
                      />
                      <button
                        onClick={() => {
                          setImagePreview(null);
                          setSelectedImage(null);
                          setRecognitionResult(null);
                        }}
                        className="absolute top-2 right-2 bg-red-500 text-white p-2 rounded-full hover:bg-red-600"
                      >
                        ✕
                      </button>
                    </div>

                    {!recognitionResult && (
                      <button
                        onClick={recognizeFood}
                        disabled={recognizing}
                        className="w-full py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg font-semibold hover:from-orange-600 hover:to-orange-700 disabled:opacity-50"
                        data-testid="recognize-button"
                      >
                        {recognizing ? 'Analyzing...' : '🔍 Analyze Food'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Recognition Results */}
              {recognitionResult && (
                <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200" data-testid="recognition-results">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">AI Analysis Results</h3>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-600">Confidence:</span>
                      <span className={`text-sm font-semibold ${recognitionResult.confidence > 0.8 ? 'text-green-600' : recognitionResult.confidence > 0.6 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {Math.round(recognitionResult.confidence * 100)}%
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between py-2 border-b border-gray-100">
                      <span className="font-medium text-gray-700">Food:</span>
                      <span className="text-gray-900">{recognitionResult.food_name}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-gray-100">
                      <span className="font-medium text-gray-700">Serving:</span>
                      <span className="text-gray-900">{recognitionResult.serving_size}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-gray-100">
                      <span className="font-medium text-gray-700">Calories:</span>
                      <span className="text-gray-900">{Math.round(recognitionResult.calories)} kcal</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-gray-100">
                      <span className="font-medium text-gray-700">Protein:</span>
                      <span className="text-gray-900">{Math.round(recognitionResult.protein)}g</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-gray-100">
                      <span className="font-medium text-gray-700">Carbs:</span>
                      <span className="text-gray-900">{Math.round(recognitionResult.carbs)}g</span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="font-medium text-gray-700">Fat:</span>
                      <span className="text-gray-900">{Math.round(recognitionResult.fat)}g</span>
                    </div>
                  </div>

                  <button
                    onClick={logMealFromRecognition}
                    disabled={loading}
                    className="w-full mt-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 disabled:opacity-50"
                    data-testid="log-meal-button"
                  >
                    {loading ? 'Logging...' : '✓ Log This Meal'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Manual Log Tab */}
          {activeTab === 'log' && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-6">Log Meal Manually</h3>
              
              <form onSubmit={logManualMeal} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Food Name</label>
                  <input
                    type="text"
                    value={foodName}
                    onChange={(e) => setFoodName(e.target.value)}
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                    placeholder="e.g., Grilled Chicken Breast"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Calories</label>
                    <input
                      type="number"
                      value={calories}
                      onChange={(e) => setCalories(e.target.value)}
                      required
                      step="0.1"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                      placeholder="165"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Serving Size</label>
                    <input
                      type="text"
                      value={servingSize}
                      onChange={(e) => setServingSize(e.target.value)}
                      required
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                      placeholder="100g"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Protein (g)</label>
                    <input
                      type="number"
                      value={protein}
                      onChange={(e) => setProtein(e.target.value)}
                      required
                      step="0.1"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                      placeholder="31"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Carbs (g)</label>
                    <input
                      type="number"
                      value={carbs}
                      onChange={(e) => setCarbs(e.target.value)}
                      required
                      step="0.1"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Fat (g)</label>
                    <input
                      type="number"
                      value={fat}
                      onChange={(e) => setFat(e.target.value)}
                      required
                      step="0.1"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500"
                      placeholder="3.6"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg font-semibold hover:from-orange-600 hover:to-orange-700 disabled:opacity-50"
                >
                  {loading ? 'Logging...' : 'Log Meal'}
                </button>
              </form>
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              {meals.length === 0 ? (
                <div className="bg-white rounded-xl p-12 text-center shadow-sm border border-gray-200">
                  <div className="text-6xl mb-4">🍽️</div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">No meals logged yet</h3>
                  <p className="text-gray-600 mb-6">Start tracking your nutrition by scanning or logging meals</p>
                  <div className="flex justify-center space-x-4">
                    <button
                      onClick={() => setActiveTab('scan')}
                      className="px-6 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg font-semibold hover:from-orange-600 hover:to-orange-700"
                    >
                      📸 Scan Food
                    </button>
                    <button
                      onClick={() => setActiveTab('log')}
                      className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200"
                    >
                      📝 Log Manually
                    </button>
                  </div>
                </div>
              ) : (
                meals.map((meal) => (
                  <div
                    key={meal.id}
                    className="bg-white rounded-xl p-6 shadow-sm border border-gray-200"
                    data-testid="meal-card"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">{meal.food_name}</h3>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-sm text-gray-500">{meal.serving_size}</span>
                          <span className="text-gray-300">•</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${meal.source === 'photo' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>
                            {meal.source === 'photo' ? '📸 Photo' : '📝 Manual'}
                          </span>
                          {meal.confidence && (
                            <>
                              <span className="text-gray-300">•</span>
                              <span className="text-xs text-gray-500">{Math.round(meal.confidence * 100)}% confident</span>
                            </>
                          )}
                        </div>
                        <span className="text-xs text-gray-400 block mt-1">
                          {new Date(meal.logged_at).toLocaleString()}
                        </span>
                      </div>
                      <button
                        onClick={() => deleteMeal(meal.id)}
                        className="text-red-500 hover:text-red-700 text-sm font-medium"
                      >
                        Delete
                      </button>
                    </div>

                    <div className="grid grid-cols-4 gap-4">
                      <div className="text-center p-3 bg-gray-50 rounded-lg">
                        <div className="text-xl font-bold text-gray-900">{Math.round(meal.calories)}</div>
                        <div className="text-xs text-gray-600">Calories</div>
                      </div>
                      <div className="text-center p-3 bg-gray-50 rounded-lg">
                        <div className="text-xl font-bold text-gray-900">{Math.round(meal.protein)}g</div>
                        <div className="text-xs text-gray-600">Protein</div>
                      </div>
                      <div className="text-center p-3 bg-gray-50 rounded-lg">
                        <div className="text-xl font-bold text-gray-900">{Math.round(meal.carbs)}g</div>
                        <div className="text-xs text-gray-600">Carbs</div>
                      </div>
                      <div className="text-center p-3 bg-gray-50 rounded-lg">
                        <div className="text-xl font-bold text-gray-900">{Math.round(meal.fat)}g</div>
                        <div className="text-xs text-gray-600">Fat</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Meals;
