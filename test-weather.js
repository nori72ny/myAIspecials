const msgs = [
  "今日の天気は？",
  "東京都新宿区の今日の天気は？",
  "明日の東京の天気",
  "大阪は雨？",
  "傘は必要？",
  "今週末の天気",
  "What is the weather today?",
  "天気予報アプリを作る方法",
  "weather APIの設計",
  "気分は天気のように変わる"
];

for (const m of msgs) {
    const isWeather = /天気(は|って|どう|教えて|知りたい|予報|.*の天気)|傘(は必要|いる)|(today\'s|tomorrow\'s)?\s*weather|雨\？/i.test(m) && !/アプリ|API|設計|作る|方法|how to|build|create/i.test(m);
    
    // A better approach: 
    const isActualWeatherQuery = /(天気(は|って|どう|教えて|知りたい|)|傘(は必要|いる)|雨(降る|？)|weather)/i.test(m) && !/(アプリ|API|設計|作る|方法|how to|build|create|気分)/i.test(m);

    console.log(m, " -> ", isActualWeatherQuery);
}
