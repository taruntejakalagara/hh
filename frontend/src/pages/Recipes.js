import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const Recipes = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('browse'); // browse, youtube, saved
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Recipe detail modal
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  
  // Recipe morpher
  const [showMorphModal, setShowMorphModal] = useState(false);
  const [targetCuisine, setTargetCuisine] = useState('');
  const [morphing, setMorphing] = useState(false);
  const [morphResult, setMorphResult] = useState(null);
  
  // YouTube import state
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [extracting, setExtracting] = useState(false);

  const cuisines = [
    'Indian', 'Mexican', 'Italian', 'Nigerian', 'American', 
    'Chinese', 'Japanese', 'Thai', 'Mediterranean', 'Korean'
  ];

  useEffect(() => {
    if (activeTab === 'browse') {
      loadRecipes(false);
    } else if (activeTab === 'saved') {
      loadRecipes(true);
    }
  }, [activeTab]);

  const loadRecipes = async (savedOnly = false) => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/recipes`, {
        params: { saved_only: savedOnly },
        headers: { Authorization: `Bearer ${token}` }
      });
      setRecipes(response.data);
    } catch (error) {
      console.error('Failed to load recipes:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSaveRecipe = async (recipeId, isSaved) => {
    try {
      const endpoint = isSaved ? 'unsave' : 'save';
      await axios.post(
        `${API}/recipes/${recipeId}/${endpoint}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      // Reload recipes
      if (activeTab === 'browse') {
        await loadRecipes(false);
      } else if (activeTab === 'saved') {
        await loadRecipes(true);
      }
    } catch (error) {
      console.error('Failed to toggle save:', error);
    }
  };

  const extractYouTubeRecipe = async (e) => {
    e.preventDefault();
    if (!youtubeUrl.trim()) return;

    setExtracting(true);
    try {
      const response = await axios.post(
        `${API}/recipes/youtube`,
        { youtube_url: youtubeUrl },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      alert('Recipe extracted successfully!');
      setYoutubeUrl('');
      setActiveTab('browse');
      await loadRecipes(false);
    } catch (error) {
      console.error('Failed to extract recipe:', error);
      alert('Failed to extract recipe. Please check the URL and try again.');
    } finally {
      setExtracting(false);
    }
  };

  const openRecipeDetail = async (recipeId) => {
    try {
      const response = await axios.get(`${API}/recipes/${recipeId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSelectedRecipe(response.data);
      setShowDetailModal(true);
    } catch (error) {
      console.error('Failed to load recipe details:', error);
    }
  };

  const morphRecipe = async () => {
    if (!targetCuisine || !selectedRecipe) return;

    setMorphing(true);
    try {
      const response = await axios.post(
        `${API}/recipes/morph`,
        {
          recipe_id: selectedRecipe.id,
          target_cuisine: targetCuisine
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setMorphResult(response.data);
      setShowMorphModal(false);
    } catch (error) {
      console.error('Failed to morph recipe:', error);
      alert('Failed to transform recipe. Please try again.');
    } finally {
      setMorphing(false);
    }
  };

  const saveMorphedRecipe = async () => {
    if (!morphResult) return;

    try {
      await axios.post(
        `${API}/recipes`,
        morphResult.morphed_recipe,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      alert('Morphed recipe saved successfully!');
      setMorphResult(null);
      setShowDetailModal(false);
      await loadRecipes(false);
    } catch (error) {
      console.error('Failed to save morphed recipe:', error);
      alert('Failed to save recipe. Please try again.');
    }
  };

  const RecipeCard = ({ recipe }) => (
    <div
      onClick={() => openRecipeDetail(recipe.id)}
      className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow cursor-pointer group"
      data-testid="recipe-card"
    >
      {/* Image */}
      <div className="relative h-48 bg-gradient-to-br from-green-100 to-emerald-100 overflow-hidden">
        {recipe.thumbnail_url || recipe.image_url ? (
          <img
            src={recipe.thumbnail_url || recipe.image_url}
            alt={recipe.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-6xl">🍳</span>
          </div>
        )}
        
        {/* Source Badge */}
        {recipe.source_type === 'youtube' && (
          <div className="absolute top-2 left-2 bg-red-600 text-white text-xs font-semibold px-2 py-1 rounded-full flex items-center space-x-1">
            <span>▶</span>
            <span>YouTube</span>
          </div>
        )}

        {/* Save Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleSaveRecipe(recipe.id, recipe.is_saved);
          }}
          className="absolute top-2 right-2 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
        >
          {recipe.is_saved ? '❤️' : '🤍'}
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">{recipe.title}</h3>
        
        {recipe.description && (
          <p className="text-sm text-gray-600 mb-3 line-clamp-2">{recipe.description}</p>
        )}

        {/* Meta Info */}
        <div className="flex items-center space-x-4 text-xs text-gray-500 mb-3">
          {recipe.prep_time && (
            <div className="flex items-center space-x-1">
              <span>⏱️</span>
              <span>{recipe.prep_time + (recipe.cook_time || 0)} min</span>
            </div>
          )}
          {recipe.servings && (
            <div className="flex items-center space-x-1">
              <span>🍽️</span>
              <span>{recipe.servings} servings</span>
            </div>
          )}
          {recipe.calories && (
            <div className="flex items-center space-x-1">
              <span>🔥</span>
              <span>{Math.round(recipe.calories)} cal</span>
            </div>
          )}
        </div>

        {/* Dietary Tags */}
        {recipe.dietary_tags && recipe.dietary_tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {recipe.dietary_tags.slice(0, 3).map((tag, index) => (
              <span
                key={index}
                className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center">
              <span className="text-xl">📖</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900" data-testid="recipes-title">Recipe Library</h1>
              <p className="text-sm text-gray-600">Discover and save recipes</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex space-x-6">
            {[
              { id: 'browse', label: 'Browse Recipes', icon: '🔍' },
              { id: 'youtube', label: 'Import from YouTube', icon: '▶️' },
              { id: 'saved', label: 'Saved Recipes', icon: '❤️' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-green-500 text-green-600'
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
        <div className="max-w-7xl mx-auto">
          {/* YouTube Import Tab */}
          {activeTab === 'youtube' && (
            <div className="max-w-2xl mx-auto">
              <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-200">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-red-100 to-red-200 rounded-full mb-4">
                    <span className="text-3xl">▶️</span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Extract Recipe from YouTube</h3>
                  <p className="text-gray-600">Paste a YouTube cooking video URL to automatically extract the recipe</p>
                </div>

                <form onSubmit={extractYouTubeRecipe} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">YouTube Video URL</label>
                    <input
                      type="url"
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      required
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                      data-testid="youtube-url-input"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={extracting}
                    className="w-full py-3 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-lg font-semibold hover:from-red-700 hover:to-red-800 disabled:opacity-50"
                    data-testid="extract-recipe-button"
                  >
                    {extracting ? 'Extracting Recipe...' : '🔍 Extract Recipe'}
                  </button>
                </form>

                <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="text-sm font-semibold text-blue-900 mb-2">How it works:</h4>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• Fetches video transcript automatically</li>
                    <li>• AI extracts ingredients and instructions</li>
                    <li>• Estimates nutrition information</li>
                    <li>• Saves to your recipe library</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Browse/Saved Recipes Grid */}
          {(activeTab === 'browse' || activeTab === 'saved') && (
            <>
              {loading ? (
                <div className="text-center py-12">
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
                  <p className="mt-4 text-gray-600">Loading recipes...</p>
                </div>
              ) : recipes.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">{activeTab === 'saved' ? '❤️' : '📖'}</div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    {activeTab === 'saved' ? 'No saved recipes yet' : 'No recipes found'}
                  </h3>
                  <p className="text-gray-600 mb-6">
                    {activeTab === 'saved' 
                      ? 'Start saving recipes to build your personal collection'
                      : 'Be the first to add a recipe to the library'
                    }
                  </p>
                  {activeTab === 'saved' && (
                    <button
                      onClick={() => setActiveTab('browse')}
                      className="px-6 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg font-semibold hover:from-green-600 hover:to-green-700"
                    >
                      Browse Recipes
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {recipes.map((recipe) => (
                    <RecipeCard key={recipe.id} recipe={recipe} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Recipe Detail Modal */}
      {showDetailModal && selectedRecipe && !morphResult && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setShowDetailModal(false)}>
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              {/* Header */}
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">{selectedRecipe.title}</h2>
                  {selectedRecipe.description && (
                    <p className="text-gray-600">{selectedRecipe.description}</p>
                  )}
                </div>
                <button onClick={() => setShowDetailModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
              </div>

              {/* Meta Info */}
              <div className="flex flex-wrap gap-4 mb-6 text-sm">
                {selectedRecipe.prep_time && (
                  <div className="flex items-center space-x-2">
                    <span>⏱️</span>
                    <span className="font-medium">{selectedRecipe.prep_time + (selectedRecipe.cook_time || 0)} min total</span>
                  </div>
                )}
                {selectedRecipe.servings && (
                  <div className="flex items-center space-x-2">
                    <span>🍽️</span>
                    <span className="font-medium">{selectedRecipe.servings} servings</span>
                  </div>
                )}
                {selectedRecipe.calories && (
                  <div className="flex items-center space-x-2">
                    <span>🔥</span>
                    <span className="font-medium">{Math.round(selectedRecipe.calories)} cal</span>
                  </div>
                )}
              </div>

              {/* Ingredients */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Ingredients</h3>
                <ul className="space-y-2">
                  {selectedRecipe.ingredients.map((ing, idx) => (
                    <li key={idx} className="flex items-start">
                      <span className="text-green-600 mr-2">•</span>
                      <span>{ing.quantity} {ing.item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Instructions */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Instructions</h3>
                <ol className="space-y-3">
                  {selectedRecipe.instructions.map((inst, idx) => (
                    <li key={idx} className="flex">
                      <span className="flex-shrink-0 w-6 h-6 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-sm font-semibold mr-3">
                        {idx + 1}
                      </span>
                      <span className="flex-1">{inst}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Actions */}
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowMorphModal(true)}
                  className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg font-semibold hover:from-purple-600 hover:to-purple-700"
                  data-testid="remix-button"
                >
                  🔄 Remix This Recipe
                </button>
                <button
                  onClick={() => toggleSaveRecipe(selectedRecipe.id, selectedRecipe.is_saved)}
                  className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200"
                >
                  {selectedRecipe.is_saved ? '❤️ Saved' : '🤍 Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cuisine Selection Modal */}
      {showMorphModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setShowMorphModal(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-gray-900 mb-4">Choose Target Cuisine</h3>
            <p className="text-gray-600 mb-6">Transform "{selectedRecipe?.title}" into:</p>
            
            <div className="grid grid-cols-2 gap-3 mb-6">
              {cuisines.map((cuisine) => (
                <button
                  key={cuisine}
                  onClick={() => setTargetCuisine(cuisine)}
                  className={`p-3 rounded-lg border-2 font-medium transition-all ${
                    targetCuisine === cuisine
                      ? 'border-purple-500 bg-purple-50 text-purple-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {cuisine}
                </button>
              ))}
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => setShowMorphModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={morphRecipe}
                disabled={!targetCuisine || morphing}
                className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg font-semibold hover:from-purple-600 hover:to-purple-700 disabled:opacity-50"
              >
                {morphing ? 'Transforming...' : 'Transform'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Morph Result Comparison Modal */}
      {morphResult && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setMorphResult(null)}>
          <div className="bg-white rounded-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Recipe Transformation</h2>
                <button onClick={() => setMorphResult(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
              </div>

              {/* Explanation */}
              <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <h3 className="font-semibold text-purple-900 mb-2">What Changed:</h3>
                <p className="text-sm text-purple-700">{morphResult.changes_explanation}</p>
              </div>

              {/* Side-by-side Comparison */}
              <div className="grid md:grid-cols-2 gap-6 mb-6">
                {/* Original */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                    <span className="mr-2">📋</span>
                    Original Recipe
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-gray-700 mb-2">Ingredients:</h4>
                      <ul className="text-sm space-y-1">
                        {morphResult.original_recipe.ingredients.map((ing, idx) => (
                          <li key={idx} className="text-gray-600">• {ing.quantity} {ing.item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Morphed */}
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-purple-900 mb-4 flex items-center">
                    <span className="mr-2">✨</span>
                    {targetCuisine} Version
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-purple-800 mb-2">New Ingredients:</h4>
                      <ul className="text-sm space-y-1">
                        {morphResult.morphed_recipe.ingredients.map((ing, idx) => (
                          <li key={idx} className="text-purple-700">• {ing.quantity} {ing.item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex space-x-3">
                <button
                  onClick={() => setMorphResult(null)}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200"
                >
                  Discard
                </button>
                <button
                  onClick={saveMorphedRecipe}
                  className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700"
                >
                  ✓ Save {targetCuisine} Version
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Recipes;
