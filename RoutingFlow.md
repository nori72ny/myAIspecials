# Routing Engine Version 2 Flow Diagram

```mermaid
graph TD
    A[ユーザーの入力 (User Input)] --> B[1. 入力内容解析 (Input Analysis)]
    B --> C[2. 必要能力抽出 (Extract Capabilities)]
    
    C -->|抽出された能力リスト: 推論, 調査, 画像生成など| D[3. 各AIの能力テーブルと比較 (Compare with DB/JSON)]
    
    D --> E{最適AIは1つで十分か？ (Is a single AI sufficient?)}
    
    E -->|Yes (単一タスク)| F[4. 最適AIを選択 (Select Optimal AI)]
    E -->|No (複数タスク)| G[5. 複数AIを選択 (Select Multiple AIs)]
    
    F --> I
    G --> H[6. 統合担当AIを選択 (Select Integration AI)]
    H --> I[7. 回答生成 (Generate Response)]
    
    I --> J[8. 品質評価 (Quality Evaluation)]
    J --> K[9. 返答 (Reply)]

```

## 能力一覧
- Reasoning (推論)
- Research (調査)
- Text Generation (文章生成)
- Image Generation (画像生成)
- Code (プログラム)
- Math (数学)
- Law (法律)
- Medical (医療)
- Marketing (マーケティング)
- Presentation (資料作成)

## モデル属性
- Speed (速度)
- Cost (料金)
- Specialties (得意分野)
- Quality (品質)
- Failure Rate (失敗率)
- Available (現在使用可能か)
