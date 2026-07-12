const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/components/ResultDashboard.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Find start index of rule 11
const startKeyword = 'ruleNum: 11,\n              title: "Mission成功率が低い場合は代替案を提示する。",';
const startIndex = content.indexOf(startKeyword);

if (startIndex === -1) {
  console.error("Could not find start keyword!");
  process.exit(1);
}

// Find end index of </div>SSED",
const endKeyword = '</div>SSED",';
const endIndex = content.indexOf(endKeyword, startIndex);

if (endIndex === -1) {
  console.error("Could not find end keyword!");
  process.exit(1);
}

const replacement = `ruleNum: 11,
              title: "Mission成功率が低い場合は代替案を提示する。",
              description: "提案の成功確率に重大なボトルネックがある場合は、単一の強硬策ではなく、代替プランを誠実に提示します。",
              complianceStatus: "PASSED" as const,
              howComplied: "成功率予測にボトルネックが確認された場合、客観的な比較対比表とデメリットも含めた3つの選択ルートを併記します。"
            },
            {
              ruleNum: 12,
              title: "不確実性を過小評価しない。",
              description: "予測モデルにおける統計的マージンや不完全なソースによるリスク、不確実性をオープンに開示します。",
              complianceStatus: "PASSED" as const,
              howComplied: "分析モデルの誤差、ソースデータの限定性をWEAK/MEDIUM評価で正直に開示し、不当な確実性の演出を排除します。"
            },
            {
              ruleNum: 13,
              title: "データの完全な削除要求に応じる。",
              description: "ユーザーが削除を選択した場合、メモリ、キャッシュ、暗号化シグネチャを一切残さず、永続的に完全削除します。",
              complianceStatus: "PASSED" as const,
              howComplied: "データ管理タブにて「即時完全消去」を実行すると、ローカルストレージおよびAIセッションが物理的に完全リセットされます。"
            },
            {
              ruleNum: 14,
              title: "AIモデルの選択ロジックを非対称にしない。",
              description: "特定ベンダーや特定の安価なモデルへの偏った最適化を行わず、ミッションの最大効率を追求した中立的な選択をします。",
              complianceStatus: "PASSED" as const,
              howComplied: "特定のモデルに固執せず、コンパイル、文書要約、分析、それぞれに世界最高峰 of 最適モデルを中立評価し適用します。"
            },
            {
              ruleNum: 15,
              title: "不都合な真実を隠さない。",
              complianceStatus: "PASSED" as const`;

content = content.substring(0, startIndex) + replacement + content.substring(endIndex + endKeyword.length);

fs.writeFileSync(filePath, content, 'utf8');
console.log("Successfully repaired!");
