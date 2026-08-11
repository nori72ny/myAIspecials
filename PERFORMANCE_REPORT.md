# Performance Report

最終確認日: 2026-08-11

この文書は、ORIGIN Personalで確認できるperformance関連証拠と、未測定項目を分離します。過去のhash付きbundle名・容量・LCP値を現在の保証値として使用しません。

## 対象

基準main:

```text
36731864fbd4cda3947fc02dbd2e2c43eb3e029b
```

## 確認済み

### Build

次のbuild経路は直近CIで成功しています。

```bash
npm ci
npm run build
```

buildは次を生成します。

```text
dist/
dist/server.cjs
dist/server.cjs.map
```

Viteのclient artifact名と容量は、依存関係・chunk分割・source変更によって変化します。旧`index-DKJ8EW28.js`等を現行artifactとして固定しません。

### CI Lighthouse

直近PR #71では、Node 22 / 24の両matrixでLighthouse stepが成功し、workflow全体がsuccessでした。

これはCI環境の設定済みthresholdに対する回帰ゲートです。次を意味しません。

- production Real User Monitoring
- すべてのページ・端末・回線での同一結果
- LCP 1.2秒の保証
- zero CLSの保証
- user-perceived performanceの完全な保証

### Runtime smoke

Node.js production runtime smokeとCloudflare Workers互換性dry runがmainへ統合されています。

これらは「起動・応答・互換性」の回帰検査であり、throughput、同時利用者数、SLAを測定するload testではありません。

## 現在値として扱わない過去記録

旧Performance Reportには次が記載されていました。

- hash付きJS/CSS artifact名
- raw / gzip bundle size
- server bundle 292.60kB
- visualizationsやnetwork graphがlarge chunkの原因という推測
- reverse proxyとしてNginx / Cloud Runを使う推奨
- peak memory約380MB
- payloadを300kB未満にできるという予測

これらは現行Exact SHAの再測定証拠と結び付いていないため、現在値・要件・推奨構成として引き継ぎません。

## 未測定

### Production Web Vitals

```text
FCP: NOT MEASURED IN PRODUCTION
LCP: NOT MEASURED IN PRODUCTION
CLS: NOT MEASURED IN PRODUCTION
INP: NOT MEASURED IN PRODUCTION
TTFB: NOT MEASURED IN PRODUCTION
Speed Index: NOT MEASURED IN PRODUCTION
TBT: NOT MEASURED IN PRODUCTION
```

### Resource

```text
peak JS heap: NOT MEASURED
average JS heap: NOT MEASURED
memory leak: NOT MEASURED
CPU usage: NOT MEASURED
server memory: NOT MEASURED
event-loop delay: NOT MEASURED
```

### Load / Network

```text
concurrent users: NOT TESTED
requests per second: NOT TESTED
p50 latency: NOT TESTED
p95 latency: NOT TESTED
p99 latency: NOT TESTED
provider latency: NOT TESTED
slow 3G/4G physical network: NOT TESTED
regional latency: NOT TESTED
long-session degradation: NOT TESTED
```

## 測定時の必須情報

新しいperformance値を公開する場合は、少なくとも次を記録します。

```text
exact Git SHA
URL and route
environment
browser and version
device or emulation profile
network profile
cold or warm cache
number of runs
median and spread
measurement tool and version
raw artifact location
timestamp
```

単発の最良値ではなく、複数runの中央値と分布を使用します。

## 改善判断

code splitting、memoization、compression、cache、pre-rendering等は、測定でbottleneckを確認してから実装します。

次を避けます。

- 使用されていない旧component名を根拠にした最適化
- cloud providerやreverse proxyの先行決定
- 実測なしのCPU / RAM割当
- CI LighthouseだけによるProduction Ready判定
- 体感だけによる改善claim

## 現在の判定

```text
production build: PASS
CI Lighthouse regression gate: PASS
Node production smoke: PASS
Workers compatibility dry run: PASS ON APPLICABLE CODE SHA
production Web Vitals: UNVERIFIED
resource profile: UNVERIFIED
load capacity: UNVERIFIED
performance superiority: UNVERIFIED
```
