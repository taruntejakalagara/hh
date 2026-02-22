import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Stores = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [selectedStore, setSelectedStore] = useState(null);
  const [storeRecipes, setStoreRecipes] = useState([]);
  const [microwaveOnly, setMicrowaveOnly] = useState(false);
  const [loadingRecipes, setLoadingRecipes] = useState(false);

  const storeTypeLabels = {
    supermarket: { icon: '🏪', label: 'Supermarket', color: 'blue' },
    gas_station: { icon: '⛽', label: 'Gas Station', color: 'red' },
    convenience_store: { icon: '🏬', label: 'Convenience', color: 'green' },
    pharmacy: { icon: '💊', label: 'Pharmacy', color: 'purple' },
    food: { icon: '💵', label: 'Dollar Store', color: 'yellow' }
  };

  const findNearbyStores = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser');
      return;
    }

    setLoading(true);
    setLocationError('');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const response = await axios.post(
            `${API}/stores/nearby`,
            {
              lat: position.coords.latitude,
              lng: position.coords.longitude
            },
            { headers: { Authorization: `Bearer ${token}` } }
          );
          setStores(response.data);
        } catch (error) {
          console.error('Failed to fetch stores:', error);
          setLocationError('Failed to fetch nearby stores. Please try again.');
        } finally {
          setLoading(false);
        }
      },
      (error) => {
        setLoading(false);
        setLocationError('Unable to get your location. Please enable location services.');
        console.error('Geolocation error:', error);
      }
    );
  };

  const loadStoreRecipes = async (store) => {
    setSelectedStore(store);
    setLoadingRecipes(true);
    
    try {
      const response = await axios.get(
        `${API}/stores/${store.store_type}/recipes`,
        {
          params: { microwave_only: microwaveOnly },
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      setStoreRecipes(response.data);
    } catch (error) {
      console.error('Failed to load store recipes:', error);
      setStoreRecipes([]);
    } finally {
      setLoadingRecipes(false);
    }
  };

  useEffect(() => {
    if (selectedStore) {
      loadStoreRecipes(selectedStore);
    }
  }, [microwaveOnly]);

  const formatDistance = (meters) => {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    }
    return `${(meters / 1000).toFixed(1)}km`;
  };

  const estimateWalkTime = (meters) => {
    // Average walking speed: 5 km/h = 83.33 m/min
    const minutes = Math.round(meters / 83.33);
    return `${minutes} min walk`;
  };

  const estimateDriveTime = (meters) => {
    // Average city driving: 40 km/h = 666.67 m/min
    const minutes = Math.round(meters / 666.67);
    return `${minutes} min drive`;
  };

  if (selectedStore && storeRecipes.length >= 0) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="max-w-7xl mx-auto">
            <button
              onClick={() => {
                setSelectedStore(null);
                setStoreRecipes([]);
              }}
              className="flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-3"
            >
              ← Back to Stores
            </button>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="text-3xl">{storeTypeLabels[selectedStore.store_type].icon}</div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white">{selectedStore.name}</h1>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{formatDistance(selectedStore.distance)} away</p>
                </div>
              </div>
              
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={microwaveOnly}
                  onChange={(e) => setMicrowaveOnly(e.target.checked)}
                  className="w-4 h-4 text-green-600 rounded"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Microwave Only</span>
              </label>
            </div>
          </div>
        </div>

        {/* Recipes */}
        <div className="px-6 py-8">
          <div className="max-w-7xl mx-auto">
            {loadingRecipes ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
                <p className="mt-4 text-gray-600 dark:text-gray-400">Loading recipes...</p>
              </div>
            ) : storeRecipes.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📖</div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">No recipes available</h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {microwaveOnly 
                    ? 'No microwave-only recipes found for this store'
                    : 'No recipes match the ingredients available at this store'}
                </p>
              </div>
            ) : (
              <>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  {storeRecipes.length} recipe{storeRecipes.length !== 1 ? 's' : ''} available with ingredients from {selectedStore.name}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {storeRecipes.map((recipe) => (
                    <div
                      key={recipe.id}
                      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                    >
                      <div className="h-48 bg-gradient-to-br from-green-100 to-emerald-100 dark:from-green-900 dark:to-emerald-900 flex items-center justify-center">
                        <span className="text-6xl">🍳</span>
                      </div>
                      <div className="p-4">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{recipe.title}</h3>
                        {recipe.prep_time && (
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            ⏱️ {recipe.prep_time + (recipe.cook_time || 0)} min
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-600 rounded-xl flex items-center justify-center">
              <span className="text-xl">🏪</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white" data-testid="stores-title">
                Local Food Sources
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">Find stores and recipes near you</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-8">
        <div className="max-w-7xl mx-auto">
          {stores.length === 0 ? (
            <div className="max-w-2xl mx-auto">
              <div className="bg-white dark:bg-gray-800 rounded-xl p-12 text-center shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-red-100 to-red-200 dark:from-red-900 dark:to-red-800 rounded-full mb-6">
                  <span className="text-4xl">📍</span>
                </div>
                <h3 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Find Nearby Stores</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-8">
                  Discover food sources near you and find recipes based on what's available locally
                </p>

                {locationError && (
                  <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-sm text-red-600 dark:text-red-400">{locationError}</p>
                  </div>
                )}

                <button
                  onClick={findNearbyStores}
                  disabled={loading}
                  className="px-8 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl font-semibold hover:from-red-600 hover:to-red-700 disabled:opacity-50 text-lg"
                  data-testid="find-stores-button"
                >
                  {loading ? 'Finding Stores...' : '📍 Find Stores Near Me'}
                </button>

                <div className="mt-8 grid grid-cols-5 gap-4 text-center">
                  {Object.entries(storeTypeLabels).map(([type, { icon, label }]) => (
                    <div key={type} className="text-gray-600 dark:text-gray-400">
                      <div className="text-2xl mb-1">{icon}</div>
                      <div className="text-xs">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {stores.length} stores found nearby
                </h2>
                <button
                  onClick={findNearbyStores}
                  className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  🔄 Refresh
                </button>
              </div>

              {stores.map((store) => {
                const storeInfo = storeTypeLabels[store.store_type];
                return (
                  <div
                    key={store.place_id}
                    onClick={() => loadStoreRecipes(store)}
                    className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow cursor-pointer"
                    data-testid="store-card"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-4 flex-1">
                        <div className="text-4xl">{storeInfo.icon}</div>
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{store.name}</h3>
                            <span className={`text-xs px-2 py-1 rounded-full bg-${storeInfo.color}-100 dark:bg-${storeInfo.color}-900 text-${storeInfo.color}-700 dark:text-${storeInfo.color}-300`}>
                              {storeInfo.label}
                            </span>
                            {store.open_now !== null && (
                              <span className={`text-xs px-2 py-1 rounded-full ${store.open_now ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'}`}>
                                {store.open_now ? '🟢 Open' : '🔴 Closed'}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{store.address}</p>
                          <div className="flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400">
                            <div className="flex items-center space-x-1">
                              <span>📏</span>
                              <span>{formatDistance(store.distance)}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <span>🚶</span>
                              <span>{estimateWalkTime(store.distance)}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <span>🚗</span>
                              <span>{estimateDriveTime(store.distance)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="text-gray-400 dark:text-gray-600 text-2xl">→</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Stores;
