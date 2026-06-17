#!/usr/bin/env node
/**
 * 计算所有作物利润（包含 VIP 作物）
 */

import { readFileSync } from 'fs';

const cropsData = JSON.parse(readFileSync('./data/farm-crops.json', 'utf-8'));
const stateData = JSON.parse(readFileSync('./data/farm-state.json', 'utf-8'));

const prices = stateData.lastExchangePrices;

console.log('═'.repeat(80));
console.log('🌾 农场作物利润分析（含 VIP 作物）');
console.log('═'.repeat(80));
console.log();

const results = cropsData.crops.map(crop => {
  const sellPrice = prices[crop.name];

  if (!sellPrice) {
    return null;
  }

  // 单轮收益和成本
  const revenue = crop.yield * sellPrice;
  const cost = crop.seedPrice;
  const firstRoundProfit = revenue - cost;  // 第一轮需要买种子
  const profitPerHour = firstRoundProfit / crop.growHours;

  // 每天可以种几轮
  const roundsPerDay = 24 / crop.growHours;

  // 关键：保留种子后，只有第一轮需要买种子！
  // 日利润 = (收入 × 轮数) - 初始种子成本
  const dailyProfit = (revenue * roundsPerDay) - cost;
  const dailyRevenue = revenue * roundsPerDay;

  return {
    name: crop.name,
    type: crop.type,
    seedPrice: crop.seedPrice,
    sellPrice,
    yield: crop.yield,
    growHours: crop.growHours,
    revenue,
    firstRoundProfit,
    profitPerHour,
    roundsPerDay,
    dailyProfit,
    dailyRevenue
  };
}).filter(Boolean);

// 按每日利润排序（这才是真正赚钱的标准）
results.sort((a, b) => b.dailyProfit - a.dailyProfit);

// 分类显示
const normal = results.filter(r => r.type === 'normal');
const vip = results.filter(r => r.type === 'vip');

console.log('📊 普通作物（按每日利润排序）');
console.log('─'.repeat(80));
normal.forEach((crop, i) => {
  console.log(`${i + 1}. ${crop.name}`);
  console.log(`   成本: ${crop.seedPrice} 金币（仅首轮） | 售价: ${crop.sellPrice.toFixed(2)} | 产量: ${crop.yield} | 周期: ${crop.growHours}h`);
  console.log(`   首轮利润: ${crop.firstRoundProfit.toFixed(2)} 金币 | 每小时: ${crop.profitPerHour.toFixed(2)} 金币/h`);
  console.log(`   每天: ${crop.roundsPerDay.toFixed(1)} 轮 | 📈 日利润: ${crop.dailyProfit.toFixed(2)} 金币 | 日收入: ${crop.dailyRevenue.toFixed(2)} 金币`);
  console.log();
});

console.log('═'.repeat(80));
console.log('💎 VIP 作物（稀有作物，按每日利润排序）');
console.log('─'.repeat(80));
vip.forEach((crop, i) => {
  console.log(`${i + 1}. ${crop.name}`);
  console.log(`   成本: ${crop.seedPrice} 金币（仅首轮） | 售价: ${crop.sellPrice.toFixed(2)} | 产量: ${crop.yield} | 周期: ${crop.growHours}h`);
  console.log(`   首轮利润: ${crop.firstRoundProfit.toFixed(2)} 金币 | 每小时: ${crop.profitPerHour.toFixed(2)} 金币/h`);
  console.log(`   每天: ${crop.roundsPerDay.toFixed(2)} 轮 | 📈 日利润: ${crop.dailyProfit.toFixed(2)} 金币 | 日收入: ${crop.dailyRevenue.toFixed(2)} 金币`);
  console.log();
});

console.log('═'.repeat(80));
console.log('🏆 TOP 5 作物（所有类型，按每小时利润）');
console.log('─'.repeat(80));
results.slice(0, 5).forEach((crop, i) => {
  const badge = crop.type === 'vip' ? '💎' : '🌾';
  console.log(`${i + 1}. ${badge} ${crop.name} - ${crop.profitPerHour.toFixed(2)} 金币/小时 (${crop.type === 'vip' ? 'VIP稀有' : '普通'})`);
});
console.log();

console.log('═'.repeat(80));
console.log('📌 当前种植: ' + stateData.selectedCrop);
const current = results.find(r => r.name === stateData.selectedCrop);
if (current) {
  console.log(`   每小时利润: ${current.profitPerHour.toFixed(2)} 金币/小时`);
  console.log(`   每天利润: ${current.dailyProfit.toFixed(2)} 金币/天`);
}
console.log('═'.repeat(80));
