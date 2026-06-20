// 利润分析脚本
const crops = [
  { name: "胡萝卜", type: "normal", seedPrice: 1, growHours: 0.5, yield: 2 },
  { name: "番茄", type: "normal", seedPrice: 2, growHours: 1, yield: 5 },
  { name: "玉米", type: "normal", seedPrice: 0.5, growHours: 1.5, yield: 25 },
  { name: "南瓜", type: "normal", seedPrice: 4, growHours: 2, yield: 6 },
  { name: "蓝莓", type: "normal", seedPrice: 1.5, growHours: 3, yield: 30 },
  { name: "草莓", type: "normal", seedPrice: 8, growHours: 4, yield: 6 },
  { name: "西瓜", type: "normal", seedPrice: 12, growHours: 6, yield: 8 },
  { name: "芒果", type: "normal", seedPrice: 5, growHours: 7, yield: 35 },
  { name: "黄金麦穗", type: "normal", seedPrice: 24, growHours: 20, yield: 30 },
  { name: "翡翠卷心菜", type: "normal", seedPrice: 32, growHours: 24, yield: 25 },
  { name: "火龙果", type: "vip", seedPrice: 20, growHours: 8, yield: 4 },
  { name: "杨桃", type: "vip", seedPrice: 30, growHours: 10, yield: 10 },
  { name: "榴莲", type: "vip", seedPrice: 10, growHours: 12, yield: 25 },
  { name: "金苹果", type: "vip", seedPrice: 60, growHours: 12, yield: 6 },
  { name: "玉露蓝玫瑰", type: "vip", seedPrice: 50, growHours: 24, yield: 8 },
  { name: "水晶葡萄", type: "vip", seedPrice: 16, growHours: 30, yield: 10 },
  { name: "彩虹凤梨", type: "vip", seedPrice: 100, growHours: 72, yield: 12 },
  { name: "月光花", type: "vip", seedPrice: 30, growHours: 48, yield: 10 },
  { name: "七日彩莲", type: "vip", seedPrice: 200, growHours: 168, yield: 20 }
];

// 最新交易所价格（2026-06-19）
const exchangePrices = {
  "南瓜": 1.18,
  "番茄": 0.73,
  "七日彩莲": 22.17,
  "玉米": 0.04,
  "榴莲": 0.59,
  "黄金麦穗": 0.74,
  "彩虹凤梨": 17.26,
  "杨桃": 3.66,
  "草莓": 2.36,
  "西瓜": 1.85,
  "月光花": 1.49,
  "水晶葡萄": 1.21,
  "芒果": 0.18,
  "蓝莓": 0.11,
  "翡翠卷心菜": 0.77,
  "火龙果": 5.46,
  "金苹果": 4.82,
  "玉露蓝玫瑰": 5.78,
  "胡萝卜": 0.84
};

const totalSlots = 13; // 当前地块数

function calculateProfit(crop, sellPrice, slots) {
  // 每轮收获 = 产量 × 地块数
  const harvestPerRound = crop.yield * slots;
  // 每轮卖出 = 收获 - 留种（每块地留1个）
  const sellPerRound = harvestPerRound - slots;
  // 每轮收入 = 卖出数量 × 售价
  const incomePerRound = sellPerRound * sellPrice;
  // 每轮成本 = 种子价格 × 地块数
  const costPerRound = crop.seedPrice * slots;
  // 每轮净利润
  const profitPerRound = incomePerRound - costPerRound;
  // 每小时收入（卖出所得）
  const incomePerHour = incomePerRound / crop.growHours;
  // 每天轮次
  const roundsPerDay = 24 / crop.growHours;
  // 每天收入
  const dailyIncome = incomePerHour * roundsPerDay;
  // 每天净利润
  const dailyProfit = profitPerRound * roundsPerDay;
  // 投资回报率（每轮）
  const roi = (profitPerRound / costPerRound) * 100;

  return {
    name: crop.name,
    type: crop.type,
    seedPrice: crop.seedPrice,
    sellPrice: sellPrice,
    yield: crop.yield,
    growHours: crop.growHours,
    harvestPerRound,
    sellPerRound,
    costPerRound: costPerRound.toFixed(2),
    incomePerRound: incomePerRound.toFixed(2),
    profitPerRound: profitPerRound.toFixed(2),
    incomePerHour: incomePerHour.toFixed(2),
    roundsPerDay: roundsPerDay.toFixed(2),
    dailyIncome: dailyIncome.toFixed(2),
    dailyProfit: dailyProfit.toFixed(2),
    roi: roi.toFixed(1)
  };
}

// 计算所有作物的利润
const results = crops
  .map(crop => {
    const sellPrice = exchangePrices[crop.name];
    if (!sellPrice) return null;
    return calculateProfit(crop, sellPrice, totalSlots);
  })
  .filter(Boolean)
  .sort((a, b) => parseFloat(b.dailyIncome) - parseFloat(a.dailyIncome));

// 输出结果
console.log('\n========================================');
console.log('🌾 农场作物利润排行榜');
console.log('========================================');
console.log(`地块数：${totalSlots} 块`);
console.log(`数据时间：2026-06-19`);
console.log('========================================\n');

console.log('📊 按每天收入排序（TOP 10）：\n');
results.slice(0, 10).forEach((item, index) => {
  const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
  const typeIcon = item.type === 'vip' ? '💎' : '🌱';
  console.log(`${medal} ${typeIcon} ${item.name}`);
  console.log(`   种子: $${item.seedPrice}  售价: $${item.sellPrice}  产量: ${item.yield}  周期: ${item.growHours}h`);
  console.log(`   每轮: 收获${item.harvestPerRound} 卖出${item.sellPerRound} 收入$${item.incomePerRound} 成本$${item.costPerRound} 净利$${item.profitPerRound}`);
  console.log(`   每天: ${item.roundsPerDay}轮 收入$${item.dailyIncome} 净利$${item.dailyProfit} ROI:${item.roi}%`);
  console.log('');
});

console.log('\n========================================');
console.log('📋 完整排行榜：');
console.log('========================================\n');

// 表格形式输出
console.log('排名 | 作物         | 类型 | 种子价 | 售价  | 周期  | 每天收入  | 每天净利  | ROI%');
console.log('-----|-------------|------|--------|-------|-------|-----------|-----------|------');
results.forEach((item, index) => {
  const rank = String(index + 1).padStart(4);
  const name = item.name.padEnd(12);
  const type = item.type === 'vip' ? '💎VIP' : '🌱普通';
  const seed = String(item.seedPrice).padStart(6);
  const sell = String(item.sellPrice).padStart(5);
  const grow = String(item.growHours + 'h').padStart(5);
  const income = String('$' + item.dailyIncome).padStart(9);
  const profit = String('$' + item.dailyProfit).padStart(9);
  const roi = String(item.roi).padStart(5);
  console.log(`${rank} | ${name} | ${type} | ${seed} | ${sell} | ${grow} | ${income} | ${profit} | ${roi}`);
});

console.log('\n========================================');
console.log('💡 策略建议：');
console.log('========================================\n');

const top3 = results.slice(0, 3);
console.log('✅ 推荐种植（收入最高前3）：');
top3.forEach((item, index) => {
  console.log(`   ${index + 1}. ${item.name} - 每天$${item.dailyIncome} (每轮净利$${item.profitPerRound})`);
});

const normalCrops = results.filter(item => item.type === 'normal');
console.log('\n✅ 普通作物推荐（前5）：');
normalCrops.slice(0, 5).forEach((item, index) => {
  console.log(`   ${index + 1}. ${item.name} - 每天$${item.dailyIncome} (ROI: ${item.roi}%)`);
});

const vipCrops = results.filter(item => item.type === 'vip');
console.log('\n💎 VIP作物推荐（前3）：');
vipCrops.slice(0, 3).forEach((item, index) => {
  console.log(`   ${index + 1}. ${item.name} - 每天$${item.dailyIncome} (ROI: ${item.roi}%)`);
});

console.log('\n========================================\n');
