// ギルド依頼プール(事前定義)。ボードはこの中からランダムで3件出題する。
// type: "hunt"(討伐) / "fetch"(おつかい配達) / "talk"(会話チャレンジ)
//  hunt : enemy(=ENEMIESの敵名), count
//  fetch: item(=FOOD_SHOPSの品名), deliverTo(=届け先NPCのid)
//  talk : npcId(=対象NPCのid), goal_en(英語の達成目標), goal_ja(日本語のお題)
// 共通: title_ja(一覧の見出し), desc_ja(詳細説明), flavor_en(受付Fiaの一言)
// ※報酬(ゴールド/GP)はゲーム側(rewardFor)で自動計算するのでここには書かない。
const QUEST_POOL = [
  // ===== エリアボス討伐(areaboss) ===== 受けるとフィールドにボスが出現。普通のコマンドバトル(コトハ参戦)。
  { type: "areaboss", boss: "ogre",   zone: "field", title_ja: "オーガ将軍の討伐",   desc_ja: "フィールドに現れたオーガ将軍を討伐しよう。受けるとフィールドに出現する。", flavor_en: "A brutish ogre general is rampaging in the fields. Take it down!" },
  { type: "areaboss", boss: "golem",  zone: "field", title_ja: "石巨人の討伐",       desc_ja: "フィールドをさまよう石巨人ゴーレムを討伐しよう。受けるとフィールドに出現する。", flavor_en: "A stone golem blocks the road. Smash it to pieces!" },
  { type: "areaboss", boss: "wyvern", zone: "field", title_ja: "ワイバーンの討伐",   desc_ja: "フィールドの空を舞うワイバーンを討伐しよう。受けるとフィールドに出現する。", flavor_en: "A fierce wyvern hunts travelers from the sky. Bring it down!" },

  // ===== 討伐(hunt) =====
  { type: "hunt", enemy: "スライム",   count: 3, title_ja: "スライム退治",   desc_ja: "フィールドでスライムを3体たおそう。",   flavor_en: "Slimes are everywhere lately. Can you thin them out?" },
  { type: "hunt", enemy: "おおコウモリ", count: 3, title_ja: "おおコウモリ退治", desc_ja: "フィールドでおおコウモリを3体たおそう。", flavor_en: "Bats are scaring travelers. Please drive them off!" },
  { type: "hunt", enemy: "ゴースト",   count: 4, title_ja: "ゴースト退治",   desc_ja: "フィールドでゴーストを4体たおそう。",   flavor_en: "Ghosts haunt the road at night. We need your help!" },
  { type: "hunt", enemy: "アーマー兵", count: 4, title_ja: "アーマー兵退治", desc_ja: "フィールドでアーマー兵を4体たおそう。", flavor_en: "Rogue armored soldiers are on the loose. Be careful!" },
  { type: "hunt", enemy: "スライム",   count: 5, title_ja: "大量発生のスライム", desc_ja: "フィールドでスライムを5体たおそう。", flavor_en: "There's a slime outbreak! Five should do it." },

  // ===== おつかい(fetch) =====
  { type: "fetch", item: "Tuna",    deliverTo: "bar",        title_ja: "Tunaをバーへ",     desc_ja: "魚屋でTuna(マグロ)を買って、バーのSalに届けよう。",       flavor_en: "Sal at the bar needs fresh tuna for tonight." },
  { type: "fetch", item: "Chicken", deliverTo: "restaurant", title_ja: "Chickenを飲食店へ", desc_ja: "肉屋でChicken(とり肉)を買って、飲食店のTomに届けよう。",   flavor_en: "The cook ran out of chicken. Could you bring some?" },
  { type: "fetch", item: "Tomato",  deliverTo: "hospital",   title_ja: "Tomatoを病院へ",   desc_ja: "八百屋でTomato(トマト)を買って、病院のHaleに届けよう。",   flavor_en: "The doctor wants fresh tomatoes for a patient." },
  { type: "fetch", item: "Sardine", deliverTo: "church",     title_ja: "Sardineを教会へ",   desc_ja: "魚屋でSardine(イワシ)を買って、教会のClaraに届けよう。",   flavor_en: "Sister Clara is preparing a meal for the needy." },
  { type: "fetch", item: "Cabbage", deliverTo: "school",     title_ja: "Cabbageを学校へ",   desc_ja: "八百屋でCabbage(キャベツ)を買って、学校のEdwinに届けよう。", flavor_en: "The school's cooking class needs some cabbage." },
  { type: "fetch", item: "Pork",    deliverTo: "smith",      title_ja: "Porkを鍛冶屋へ",   desc_ja: "肉屋でPork(ぶた肉)を買って、鍛冶屋のBorinに届けよう。",     flavor_en: "Borin's starving after a long day at the forge!" },

  // ===== 会話チャレンジ(talk) =====
  { type: "talk", npcId: "hospital",   goal_en: "ask the doctor for advice about a headache",      goal_ja: "医者に頭痛の相談をする",     title_ja: "医者に相談する", desc_ja: "病院のHaleに英語で話しかけて「頭痛の相談」をしよう。",       flavor_en: "A patient is shy. Show them how to ask the doctor!" },
  { type: "talk", npcId: "bard",       goal_en: "compliment the bard's song",                      goal_ja: "吟遊詩人の歌をほめる",       title_ja: "歌をほめる",     desc_ja: "町の吟遊詩人Lyraに英語で話しかけて「歌をほめよう」。",       flavor_en: "Lyra's been gloomy. A kind word would cheer her up." },
  { type: "talk", npcId: "police",     goal_en: "ask the guard for directions to the castle",      goal_ja: "衛兵に城への道をたずねる",   title_ja: "道をたずねる",   desc_ja: "警察署のBrunoに英語で話しかけて「城への道」をたずねよう。", flavor_en: "A traveler is lost. Ask the guard the way!" },
  { type: "talk", npcId: "restaurant", goal_en: "ask the cook to recommend today's special",       goal_ja: "料理人に本日のおすすめを聞く", title_ja: "おすすめを聞く", desc_ja: "飲食店のTomに英語で話しかけて「本日のおすすめ」を聞こう。", flavor_en: "Tom loves to recommend his dishes. Go ask him!" },
  { type: "talk", npcId: "bank",       goal_en: "ask how to open a bank account",                  goal_ja: "口座の開き方をたずねる",     title_ja: "口座について聞く", desc_ja: "銀行のGretaに英語で話しかけて「口座の開き方」を聞こう。",   flavor_en: "Greta can explain banking. Practice asking her!" },
  { type: "talk", npcId: "church",     goal_en: "ask the sister for a blessing for your journey",  goal_ja: "シスターに旅の祝福をお願いする", title_ja: "祝福をお願いする", desc_ja: "教会のClaraに英語で話しかけて「旅の祝福」をお願いしよう。", flavor_en: "Before a long trip, ask Clara for a blessing." },
  { type: "talk", npcId: "bar",        goal_en: "order a drink at the bar",                        goal_ja: "バーで飲み物を注文する",       title_ja: "飲み物を注文する", desc_ja: "バーのSalに英語で話しかけて「飲み物を注文」しよう。",         flavor_en: "Sal's waiting for customers — go order something!" },
  { type: "talk", npcId: "bar",        goal_en: "ask the bartender about a local rumor",           goal_ja: "バーの主人に町の噂を聞く",     title_ja: "噂を聞く",         desc_ja: "バーのSalに英語で話しかけて「町の噂」を聞き出そう。",         flavor_en: "Sal always knows the latest gossip. Ask him!" },
  { type: "talk", npcId: "school",     goal_en: "ask the teacher to explain an English word",      goal_ja: "先生に英単語の意味を教えてもらう", title_ja: "単語の意味を聞く", desc_ja: "学校のEdwinに英語で話しかけて「ある英単語の意味」を教えてもらおう。", flavor_en: "Edwin loves teaching. Ask him about a word!" },
  { type: "talk", npcId: "school",     goal_en: "introduce yourself to the teacher",              goal_ja: "先生に自己紹介する",           title_ja: "自己紹介する",     desc_ja: "学校のEdwinに英語で話しかけて「自己紹介」をしよう。",         flavor_en: "Edwin welcomes new faces. Introduce yourself!" },
  { type: "talk", npcId: "smith",      goal_en: "ask the blacksmith which weapon he recommends",   goal_ja: "鍛冶屋におすすめの武器を聞く", title_ja: "武器を相談する",   desc_ja: "鍛冶屋のBorinに英語で話しかけて「おすすめの武器」を聞こう。", flavor_en: "Borin's proud of his blades. Ask his advice!" },
  { type: "talk", npcId: "smith",      goal_en: "thank the blacksmith for his hard work",         goal_ja: "鍛冶屋に感謝を伝える",         title_ja: "感謝を伝える",     desc_ja: "鍛冶屋のBorinに英語で話しかけて「感謝」を伝えよう。",         flavor_en: "A kind word for hard-working Borin would be nice." },
  { type: "talk", npcId: "adv_rex",    goal_en: "ask the veteran warrior for adventure tips",     goal_ja: "ベテラン戦士に冒険のコツを聞く", title_ja: "冒険のコツを聞く", desc_ja: "ギルドの冒険者Rexに英語で話しかけて「冒険のコツ」を聞こう。", flavor_en: "Rex loves bragging — turn it into useful advice!" },
  { type: "talk", npcId: "adv_mina",   goal_en: "ask the mage about magic",                       goal_ja: "魔法使いに魔法のことを聞く",   title_ja: "魔法について聞く", desc_ja: "ギルドの魔法使いMinaに英語で話しかけて「魔法のこと」を聞こう。", flavor_en: "Mina knows much about magic. Ask her!" },
  { type: "talk", npcId: "adv_pip",    goal_en: "cheer up the nervous rookie adventurer",         goal_ja: "新人冒険者を励ます",           title_ja: "新人を励ます",     desc_ja: "ギルドの新人冒険者Pipに英語で話しかけて「励まそう」。",       flavor_en: "Pip's nervous about a quest. Give him courage!" },
  { type: "talk", npcId: "hospital",   goal_en: "ask the doctor how to stay healthy",             goal_ja: "医者に健康法をたずねる",       title_ja: "健康法を聞く",     desc_ja: "病院のHaleに英語で話しかけて「健康でいる方法」を聞こう。",   flavor_en: "Hale gives great health advice. Go ask!" },
  { type: "talk", npcId: "restaurant", goal_en: "ask the cook how much a meal costs",              goal_ja: "料理人に食事の値段を聞く",     title_ja: "値段を聞く",       desc_ja: "飲食店のTomに英語で話しかけて「食事の値段」を聞こう。",       flavor_en: "Curious about prices? Ask Tom!" },
  { type: "talk", npcId: "bank",       goal_en: "ask how to exchange money at the bank",          goal_ja: "銀行で両替の方法を聞く",       title_ja: "両替について聞く", desc_ja: "銀行のGretaに英語で話しかけて「両替の方法」を聞こう。",       flavor_en: "Greta handles currency. Ask how to exchange!" },
  { type: "talk", npcId: "bard",       goal_en: "ask the bard to teach you a song",               goal_ja: "吟遊詩人に歌を教えてもらう",   title_ja: "歌を教わる",       desc_ja: "町の吟遊詩人Lyraに英語で話しかけて「歌を教えて」とお願いしよう。", flavor_en: "Lyra would love to teach a song. Ask her!" },
  { type: "talk", npcId: "police",     goal_en: "ask the guard if the town is safe at night",     goal_ja: "衛兵に夜の町の安全を聞く",     title_ja: "治安をたずねる",   desc_ja: "警察署のBrunoに英語で話しかけて「夜の町は安全か」聞こう。",   flavor_en: "Worried about the night? Ask the guard." },
];
