/**
 * Weather Service Usage Examples
 * Demonstrates how to use the weather-based intent signals
 */

import { weatherService } from '../services/WeatherService.js';

// Example: Get weather by coordinates
async function exampleByCoordinates() {
  // San Francisco coordinates
  const lat = 37.7749;
  const lon = -122.4194;

  const weather = await weatherService.getWeatherByCoordinates(lat, lon);

  if (weather) {
    console.log('Current Weather:');
    console.log(`  Location: ${weather.location.city}, ${weather.location.country}`);
    console.log(`  Condition: ${weather.condition}`);
    console.log(`  Temperature: ${weather.temperature.current}°C (feels like ${weather.temperature.feelsLike}°C)`);
    console.log(`  Humidity: ${weather.humidity}%`);
    console.log(`  Wind: ${weather.windSpeed} km/h`);
  }
}

// Example: Get weather by city name
async function exampleByCity() {
  const weather = await weatherService.getWeatherByCity('London', 'UK');

  if (weather) {
    console.log('London Weather:');
    console.log(`  Condition: ${weather.condition} - ${weather.description}`);
    console.log(`  Temperature: ${weather.temperature.current}°C`);
  }
}

// Example: Get weather signal with intent modifiers
async function exampleWeatherSignal() {
  const userId = 'user_123';
  const lat = 37.7749;
  const lon = -122.4194;

  const signal = await weatherService.getWeatherSignal(userId, lat, lon);

  if (signal) {
    console.log('\nWeather Signal for User:');
    console.log(`  User ID: ${signal.userId}`);
    console.log(`  Condition: ${signal.weather.condition}`);
    console.log(`  Modifiers:`);
    console.log(`    - Delivery Boost: +${(signal.modifiers.deliveryBoost * 100).toFixed(0)}%`);
    console.log(`    - Dining Boost: +${(signal.modifiers.diningBoost * 100).toFixed(0)}%`);
    console.log(`    - Travel Boost: +${(signal.modifiers.travelBoost * 100).toFixed(0)}%`);
    console.log(`    - Outdoor Boost: +${(signal.modifiers.outdoorBoost * 100).toFixed(0)}%`);
    console.log(`    - Indoor Boost: +${(signal.modifiers.indoorBoost * 100).toFixed(0)}%`);
    console.log(`  Expires: ${signal.expiresAt.toISOString()}`);
  }
}

// Example: Get category-specific modifier
async function exampleCategoryModifier() {
  const weather = await weatherService.getWeatherByCoordinates(37.7749, -122.4194);

  if (weather) {
    const categories = ['delivery', 'dining', 'travel', 'outdoor', 'retail'];

    console.log('\nCategory Boost Based on Weather:');
    console.log(`  Weather: ${weather.condition}, ${weather.temperature.current}°C\n`);

    for (const category of categories) {
      const boost = weatherService.getWeatherBoost(weather.condition, category);
      console.log(`  ${category.padEnd(12)}: ${boost >= 0 ? '+' : ''}${(boost * 100).toFixed(0)}%`);
    }
  }
}

// Example: Intent capture with weather context
async function exampleIntentCaptureWithWeather() {
  const { intentCaptureService } = await import('../services/IntentCaptureService.js');

  // Capture an intent with weather context
  const result = await intentCaptureService.capture({
    userId: 'user_123',
    appType: 'restaurant',
    eventType: 'view',
    category: 'dining',
    intentKey: 'sushi_restaurants',
    intentQuery: 'sushi near me',
    weather: {
      lat: 37.7749,
      lon: -122.4194,
    },
  });

  console.log('\nIntent Captured with Weather Context:');
  console.log(`  Intent Key: ${result.intent.intentKey}`);
  console.log(`  Confidence: ${(result.intent.confidence * 100).toFixed(1)}%`);
  console.log(`  Weather Boost Applied: ${result.weatherBoostApplied ? (result.weatherBoostApplied * 100).toFixed(1) : '0'}%`);

  if (result.weatherSignal) {
    console.log(`  Weather Condition: ${result.weatherSignal.weather.condition}`);
  }
}

// Run all examples
async function main() {
  console.log('='.repeat(60));
  console.log('Weather Service Examples');
  console.log('='.repeat(60));

  await exampleByCoordinates();
  await exampleByCity();
  await exampleWeatherSignal();
  await exampleCategoryModifier();
  await exampleIntentCaptureWithWeather();
}

main().catch(console.error);
