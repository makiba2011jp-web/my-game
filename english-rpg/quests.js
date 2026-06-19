// ギルド依頼プール(事前定義)。ボードはこの中からランダムで3件出題する。
// type: "hunt"(討伐) / "fetch"(おつかい配達) / "talk"(会話チャレンジ)
//  hunt : enemy(=ENEMIESの敵名), count
//  fetch: item(=FOOD_SHOPSの品名), deliverTo(=届け先NPCのid)
//  talk : npcId(=対象NPCのid), goal_en(英語の達成目標), goal_ja(日本語のお題)
// 共通: title_ja(一覧の見出し), desc_ja(詳細説明), flavor_en(受付Fiaの一言)
// ※報酬(ゴールド/GP)はゲーム側(rewardFor)で自動計算するのでここには書かない。
const QUEST_POOL = [
  // ===== 討伐(hunt) =====
  { type: "hunt", enemy: "スライム",   count: 3, title_ja: "スライム退治",   desc_ja: "フィールドでスライムを3体たおそう。",   flavor_en: "Slimes are everywhere lately. Can you thin them out?" },
  { type: "hunt", enemy: "おおコウモリ", count: 3, title_ja: "おおコウモリ退治", desc_ja: "フィールドでおおコウモリを3体たおそう。", flavor_en: "Bats are scaring travelers. Please drive them off!" },
  { type: "hunt", enemy: "ゴースト",   count: 4, title_ja: "ゴースト退治",   desc_ja: "フィールドでゴーストを4体たおそう。",   flavor_en: "Ghosts haunt the road at night. We need your help!" },
  { type: "hunt", enemy: "アーマー兵", count: 4, title_ja: "アーマー兵退治", desc_ja: "フィールドでアーマー兵を4体たおそう。", flavor_en: "Rogue armored soldiers are on the loose. Be careful!" },
  { type: "hunt", enemy: "スライム",   count: 5, title_ja: "大量発生のスライム", desc_ja: "フィールドでスライムを5体たおそう。", flavor_en: "There's a slime outbreak! Five should do it." },

  // ===== おつかい(fetch) =====
  { type: "fetch", item: "マグロ",   deliverTo: "bar",        title_ja: "マグロをバーへ",     desc_ja: "魚屋でマグロを買って、バーのSalに届けよう。",       flavor_en: "Sal at the bar needs fresh tuna for tonight." },
  { type: "fetch", item: "とり肉",   deliverTo: "restaurant", title_ja: "とり肉を飲食店へ",   desc_ja: "肉屋でとり肉を買って、飲食店のTomに届けよう。",     flavor_en: "The cook ran out of chicken. Could you bring some?" },
  { type: "fetch", item: "トマト",   deliverTo: "hospital",   title_ja: "トマトを病院へ",     desc_ja: "八百屋でトマトを買って、病院のHaleに届けよう。",   flavor_en: "The doctor wants fresh tomatoes for a patient." },
  { type: "fetch", item: "イワシ",   deliverTo: "church",     title_ja: "イワシを教会へ",     desc_ja: "魚屋でイワシを買って、教会のClaraに届けよう。",     flavor_en: "Sister Clara is preparing a meal for the needy." },
  { type: "fetch", item: "キャベツ", deliverTo: "school",     title_ja: "キャベツを学校へ",   desc_ja: "八百屋でキャベツを買って、学校のEdwinに届けよう。", flavor_en: "The school's cooking class needs some cabbage." },
  { type: "fetch", item: "ぶた肉",   deliverTo: "smith",      title_ja: "ぶた肉を鍛冶屋へ",   desc_ja: "肉屋でぶた肉を買って、鍛冶屋のBorinに届けよう。",   flavor_en: "Borin's starving after a long day at the forge!" },

  // ===== 会話チャレンジ(talk) =====
  { type: "talk", npcId: "hospital",   goal_en: "ask the doctor for advice about a headache",      goal_ja: "医者に頭痛の相談をする",     title_ja: "医者に相談する", desc_ja: "病院のHaleに英語で話しかけて「頭痛の相談」をしよう。",       flavor_en: "A patient is shy. Show them how to ask the doctor!" },
  { type: "talk", npcId: "bard",       goal_en: "compliment the bard's song",                      goal_ja: "吟遊詩人の歌をほめる",       title_ja: "歌をほめる",     desc_ja: "町の吟遊詩人Lyraに英語で話しかけて「歌をほめよう」。",       flavor_en: "Lyra's been gloomy. A kind word would cheer her up." },
  { type: "talk", npcId: "police",     goal_en: "ask the guard for directions to the castle",      goal_ja: "衛兵に城への道をたずねる",   title_ja: "道をたずねる",   desc_ja: "警察署のBrunoに英語で話しかけて「城への道」をたずねよう。", flavor_en: "A traveler is lost. Ask the guard the way!" },
  { type: "talk", npcId: "restaurant", goal_en: "ask the cook to recommend today's special",       goal_ja: "料理人に本日のおすすめを聞く", title_ja: "おすすめを聞く", desc_ja: "飲食店のTomに英語で話しかけて「本日のおすすめ」を聞こう。", flavor_en: "Tom loves to recommend his dishes. Go ask him!" },
  { type: "talk", npcId: "bank",       goal_en: "ask how to open a bank account",                  goal_ja: "口座の開き方をたずねる",     title_ja: "口座について聞く", desc_ja: "銀行のGretaに英語で話しかけて「口座の開き方」を聞こう。",   flavor_en: "Greta can explain banking. Practice asking her!" },
  { type: "talk", npcId: "church",     goal_en: "ask the sister for a blessing for your journey",  goal_ja: "シスターに旅の祝福をお願いする", title_ja: "祝福をお願いする", desc_ja: "教会のClaraに英語で話しかけて「旅の祝福」をお願いしよう。", flavor_en: "Before a long trip, ask Clara for a blessing." },
];
