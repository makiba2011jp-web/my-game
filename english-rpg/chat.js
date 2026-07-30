"use strict";

// =====================================================================
// AI接続設定
//   mode "browser": ブラウザから直接 Anthropic API を呼ぶ（開発・テスト用）
//                   APIキーは localStorage に保存し、Anthropicへのリクエストにのみ使用。
//   mode "proxy"  : 本公開用。Cloudflare Worker などのプロキシ経由（キーはサーバー側）。
//                   proxyUrl に Worker のURLを入れて mode を "proxy" にするだけ。
// =====================================================================
// 使えるモデルと料金($/1M tokens)
const MODELS = {
  opus:  { id: "claude-opus-4-8", label: "Opus 4.8", in: 5 / 1e6, out: 25 / 1e6, effort: true },
  haiku: { id: "claude-haiku-4-5", label: "Haiku 4.5", in: 1 / 1e6, out: 5 / 1e6, effort: false }, // Haikuはeffort非対応
};
const AI_CONFIG = {
  mode: "browser",            // "browser" | "proxy"
  proxyUrl: "",               // 例: "https://english-rpg.xxxx.workers.dev"
  modelKey: localStorage.getItem("ai_model") === "haiku" ? "haiku" : "opus",
  get model() { return MODELS[this.modelKey].id; }, // 実際に送るモデルID
  apiVersion: "2023-06-01",
  maxTokens: 600,
};
function curModel() { return MODELS[AI_CONFIG.modelKey] || MODELS.opus; }
// effort はモデルにより未対応(Haiku 4.5は400)。対応モデルのみ付ける。
function outputConfig(withFormat) { return outputConfigWith(withFormat ? SCHEMA : null); }
function outputConfigWith(schema) {
  const oc = {};
  if (curModel().effort) oc.effort = "low";
  if (schema) oc.format = { type: "json_schema", schema };
  return Object.keys(oc).length ? oc : undefined;
}
function setModel(key) {
  AI_CONFIG.modelKey = MODELS[key] ? key : "opus";
  localStorage.setItem("ai_model", AI_CONFIG.modelKey);
  renderModelBtn();
  renderTokenUsage();
}
function toggleModel() { setModel(AI_CONFIG.modelKey === "opus" ? "haiku" : "opus"); }
function renderModelBtn() {
  const b = document.getElementById("dev-model");
  if (b) b.textContent = "モデル:" + curModel().label;
}
window.toggleModel = toggleModel; window.setModel = setModel;
const API_KEY_STORE = "anthropic_api_key";
const getApiKey = () => localStorage.getItem(API_KEY_STORE) || "";
const setApiKey = (k) => localStorage.setItem(API_KEY_STORE, k);

// クエスト連動: 会話中に特定の条件を満たすと quest_flag が立つ
// { note: 英語の条件文, flagMessage?: 表示文, onFlag?: 即時実行, onClose?: 閉じたとき実行 }
let questHook = null;
let travelerKnown = false; // この会話相手が主人公と面識ありか(名前で呼ぶ)
let pendingClose = null; // フラグ発火後、会話を閉じたときに実行する動作
function aiReady() {
  return AI_CONFIG.mode === "proxy" ? !!AI_CONFIG.proxyUrl : !!getApiKey();
}

// ===== NPCペルソナ / 難易度 / 出力スキーマ（プロンプトはブラウザ側で構築）=====
const NPC_PERSONA = {
  innkeeper: "You are Marian, the warm and chatty innkeeper of a small fantasy town. You enjoy talking about food, cozy rooms, and the stories of travelers who pass through.",
  smith: "You are Borin, a gruff but kind-hearted blacksmith. You talk about weapons, armor, and slaying monsters. You respect brave adventurers.",
  bard: "You are Lyra, a cheerful traveling bard. You love rumors, songs, and tales about the distant Demon King the hero must defeat.",
  matshop: "You are Gil, the owner of the material shop (素材屋). You buy raw materials that adventurers gather from monsters — slime jelly, bat wings, ghost shards and the like. You are a practical, friendly trader who loves a good deal. You do NOT run an inn and do not offer rooms or food.",
  weaponshop: "You are Dunn, the owner of the weapon shop (武器屋). You sell swords, shields, and armor to adventurers and are proud of your craft. You do NOT run an inn and do not offer rooms or food.",
  guild_receptionist: "You are Fia, the cheerful and polite receptionist at the Adventurers' Guild. You register adventurers, post quests on the board, and explain how the guild works. You are warm and encouraging, especially to newcomers.",
  adv_rex: "You are Rex, a boastful veteran warrior relaxing in the Adventurers' Guild. You love bragging about the monsters you've slain and giving big-talking advice to rookies. You're loud but good-natured.",
  adv_mina: "You are Mina, a calm and clever mage at the Adventurers' Guild. You speak thoughtfully, love books and magic, and give level-headed, useful advice.",
  adv_pip: "You are Pip, a nervous rookie adventurer at the Adventurers' Guild. You're excited but easily scared, still learning the ropes, and you look up to stronger adventurers.",
  restaurant: "You are Tom, a hearty cook who runs the town's restaurant. You love talking about food, recipes, and recommending today's special. Warm and a bit chatty.",
  bar: "You are Sal, the easygoing owner of the town bar (tavern). You serve drinks, swap rumors, and listen to travelers' stories. Relaxed and friendly.",
  bank: "You are Greta, the polite and precise teller at the town bank. You talk about saving money, deposits, and keeping gold safe. Calm and businesslike.",
  school: "You are Edwin, a kind teacher at the town school. You love explaining things clearly, encouraging learners, and praising effort. Patient and gentle.",
  hospital: "You are Hale, the town doctor. You ask how people feel, give health advice, and reassure the worried. Caring and calm.",
  church: "You are Clara, a gentle sister at the town church. You offer comfort, blessings, and quiet encouragement to travelers. Serene and kind.",
  salon: "You are Coco, the cheerful stylist at the town hair salon. You chat happily about hair, fashion, and looking your best. You also keep a beloved pet cat. Bubbly and upbeat. You do NOT run an inn and do not offer rooms.",
  police: "You are Bruno, a dependable town guard at the police station. You keep the peace, give directions, and warn about dangers outside town. Steady and dutiful.",
  florist: "You are Lily, a sweet, slightly shy girl who runs the town's flower shop. You adore flowers and gentle conversation. You are warm and encouraging, and you visibly light up and get happier when the traveler speaks beautiful, fluent English.",
  fish: "You are Finn, the lively owner of the fish shop (魚屋). You sell fresh fish like tuna (マグロ) and sardines (イワシ), and love talking about the day's catch. You do NOT run an inn and do not offer rooms.",
  green: "You are Vera, the friendly owner of the greengrocer (八百屋). You sell fresh vegetables and fruit, and enjoy recommending what's in season. You do NOT run an inn and do not offer rooms.",
  meat: "You are Otto, the hearty owner of the butcher shop (肉屋). You sell meat of all kinds and love a good barbecue. You do NOT run an inn and do not offer rooms.",
  grocery: "You are Marco, the friendly clerk at the grocery stall (食料品店) inside the town's food market. You sell pantry goods — eggs, cooking oil, salt, soy sauce, sugar, butter and the like — and love giving little cooking tips. You do NOT run an inn and do not offer rooms.",
  realestate: "You are Estelle, the polished and friendly owner of the town's real estate agency (不動産屋). You sell houses and properties to travelers who want a home of their own — a small cottage, a stone house, or a grand manor. You love talking about rooms, gardens, and the perfect place to live. You do NOT run an inn and do NOT offer rooms for the night or food; you sell houses to OWN.",
  appliance: "You are Den, the cheerful owner of the town's appliance shop (家電屋). You sell home appliances — refrigerators and televisions — and love explaining their features. A fridge keeps food fresh; a TV shows news, anime and variety programs. You do NOT run an inn and do not offer rooms or food.",
};
// 会話開始の“最初の一言”を定型文からランダムに出すNPC(AI呼び出しを省いてトークン節約)。
// { en:英語のあいさつ, ja:その和訳 }。2ターン目以降はいつもどおりAIが応答する。
const NPC_GREETINGS = {
  bard: [
    { en: "Well met, traveler! I'm Lyra, a wandering bard. Care to hear a song or a rumor?", ja: "やあ旅人さん！ 私はさすらいの吟遊詩人ライラ。歌か噂話、聞いていく？" },
    { en: "Oh, a new face! Or... have we met before? Either way, welcome! What shall we talk about?", ja: "あら、新しい顔！ …それとも前に会ったかな？ どちらにせよ、ようこそ！ 何を話そうか？" },
    { en: "Greetings! The road is long, but a good chat makes it feel shorter. What's on your mind?", ja: "こんにちは！ 旅は長いけど、いいおしゃべりは道を短く感じさせるの。何か話したいことは？" },
    { en: "Hello there! I collect songs and stories from every town. Do you have one to share?", ja: "どうも！ 私はどの町でも歌や物語を集めているの。あなたのお話も聞かせてくれる？" },
    { en: "Ah, a traveler with brave eyes! Come now — what brings you to me today?", ja: "おお、勇敢な目をした旅人だね！ さあ、今日はどうして私のところへ？" },
    { en: "Nice to see you! Lately I've heard whispers about the Demon King... but first, how are you?", ja: "会えてうれしい！ 最近、魔王の噂を耳にするの…でもまずは、調子はどう？" },
  ],
  innkeeper: [
    { en: "Welcome, traveler! I'm Marian. Come in and rest — are you hungry, or looking for a room?", ja: "ようこそ旅人さん！ 女将のマリアンよ。入って休んでいって。お腹すいてる？ それともお部屋かしら？" },
    { en: "Oh, hello there! You look tired. A warm meal and a soft bed will fix that. What do you need?", ja: "あら、こんにちは！ 疲れた顔ね。温かい食事とふかふかのベッドがあれば大丈夫。何が必要？" },
    { en: "Welcome back to my inn! The fire's warm and the soup's ready. How was your journey?", ja: "宿へおかえりなさい！ 暖炉は暖かいし、スープもできてるわ。旅はどうだった？" },
    { en: "Come in, come in! Travelers always have the best stories. Where are you headed?", ja: "さあ入って入って！ 旅人さんはいつも面白い話を持ってるのよね。どこへ向かってるの？" },
    { en: "Hello, dear! You're just in time for supper. Would you like something to eat?", ja: "こんにちは、あなた！ ちょうど夕食どきよ。何か食べていく？" },
  ],
  smith: [
    { en: "Hmph. A customer. I'm Borin. Need a sword sharpened, or armor mended?", ja: "ふん、客か。俺はボリンだ。剣を研ぐか、鎧を直すか？" },
    { en: "Welcome to my forge. Steel protects those who fight. What are you after?", ja: "俺の鍛冶場へようこそ。鋼は戦う者を守る。何が欲しい？" },
    { en: "So, you're an adventurer? Good. Show me your blade and I'll judge it.", ja: "冒険者か？ いい。剣を見せろ、使い物になるか見てやる。" },
    { en: "Back again? Hah. A warrior who cares for their gear lives longer. What do you need?", ja: "また来たか。ふっ、装備を大事にする戦士は長生きする。何が要る？" },
    { en: "Careful with that armor. Monsters bite hard out there. Need something forged?", ja: "その鎧、気をつけろよ。外の魔物の牙は鋭い。何か打とうか？" },
  ],
  matshop: [
    { en: "Ah, a supplier! I'm Gil. Got any monster materials to sell? I pay fair prices.", ja: "おっ、仕入れ先だ！ 俺はギル。魔物の素材、売りに来たか？ ちゃんと払うぜ。" },
    { en: "Welcome! Slime jelly, bat wings, ghost shards — I buy it all. What have you got?", ja: "いらっしゃい！ スライムゼリー、コウモリの羽、ゴーストのかけら、なんでも買うぞ。何がある？" },
    { en: "Hey there, adventurer! Gathered anything good out there? Let's talk business.", ja: "よう冒険者！ 外でいいもん集めてきたか？ 商売の話といこう。" },
    { en: "Come in, come in! A good deal makes my day. What materials are you carrying?", ja: "入った入った！ いい取引は俺の一日を最高にするんだ。どんな素材を持ってる？" },
    { en: "Welcome back! Business is business. Show me what you found on your travels.", ja: "おかえり！ 商売は商売だ。旅で見つけたもんを見せてくれ。" },
  ],
  weaponshop: [
    { en: "Welcome! I'm Dunn. Looking for a new sword, or a sturdy shield?", ja: "いらっしゃい！ 俺はダン。新しい剣か、頑丈な盾をお探しかい？" },
    { en: "Step right up! Every blade here is forged with pride. What catches your eye?", ja: "さあ寄ってって！ ここの剣はどれも誇りを込めて打ったものだ。どれが気になる？" },
    { en: "Ah, an adventurer! Good gear keeps you alive. Sword, shield, or armor today?", ja: "お、冒険者だな！ いい装備が命を守る。今日は剣か、盾か、鎧か？" },
    { en: "Welcome back! Ready to upgrade your equipment? I've got some fine pieces.", ja: "おかえり！ 装備を新調する気か？ いいのが揃ってるぜ。" },
    { en: "Come and see! A warrior is only as good as their steel. What'll it be?", ja: "見ていきな！ 戦士の強さは持つ鋼で決まる。どうする？" },
  ],
  guild_receptionist: [
    { en: "Welcome to the Adventurers' Guild! I'm Fia. How can I help you today?", ja: "冒険者ギルドへようこそ！ 受付のフィアです。今日はどうしましたか？" },
    { en: "Hello, adventurer! Looking for a quest, or is there something I can do for you?", ja: "こんにちは、冒険者さん！ 依頼をお探しですか？ それとも何かご用でしょうか？" },
    { en: "Welcome back to the guild! Your hard work is always appreciated. What do you need?", ja: "ギルドへおかえりなさい！ いつも頑張ってくれて感謝です。ご用件は？" },
    { en: "Good day! The guild is here to support you. Feel free to ask me anything.", ja: "こんにちは！ ギルドはあなたを応援します。何でも聞いてくださいね。" },
    { en: "Hello there! Every great adventurer started small. How can I assist you?", ja: "こんにちは！ 偉大な冒険者もみんな最初は小さな一歩から。今日はどんなご用ですか？" },
  ],
  adv_rex: [
    { en: "Ha! Another rookie, eh? I'm Rex, the greatest warrior you'll meet. Want advice?", ja: "はっ！ また新人か？ 俺はレックス、お前が会う中で最強の戦士だ。助言でも欲しいか？" },
    { en: "You there! You've got the look of a fighter. Sit — let me tell you about my battles!", ja: "そこのお前！ 戦士の顔つきだな。座れ、俺の武勇伝を聞かせてやる！" },
    { en: "Hah, back for more of my wisdom? Smart. Ask me anything about slaying monsters!", ja: "はは、また俺の知恵が欲しくて来たか？ 賢いな。魔物退治のことなら何でも聞け！" },
    { en: "Welcome, welcome! A true hero always makes time for fans. What do you want to know?", ja: "よう、よう！ 真の英雄はファンのために時間を作るもんだ。何が知りたい？" },
    { en: "You look strong, kid — almost as strong as me! Ha! Come, let's talk fighting.", ja: "強そうだな小僧、俺に迫るくらいにな！ はは！ さあ、戦いの話をしようぜ。" },
  ],
  adv_mina: [
    { en: "Oh, hello. I'm Mina. I was just reading. Is there something you'd like to ask?", ja: "あら、こんにちは。ミナよ。ちょうど本を読んでいたの。何か聞きたいこと？" },
    { en: "Greetings, adventurer. A calm mind wins battles. What's on yours today?", ja: "ごきげんよう、冒険者さん。冷静な心が戦いを制するの。今日は何を考えているの？" },
    { en: "Welcome. Knowledge is a fine weapon. Feel free to ask me anything you wish.", ja: "ようこそ。知識は立派な武器よ。何でも遠慮なく聞いてね。" },
    { en: "Ah, it's you again. Good. I always enjoy a thoughtful conversation. What is it?", ja: "あら、またあなたね。いいわ。私は考え深い会話がいつも好きなの。どうしたの？" },
    { en: "Hello there. Magic and books — those are my world. Care to talk for a while?", ja: "こんにちは。魔法と本、それが私の世界。少しおしゃべりしていく？" },
  ],
  adv_pip: [
    { en: "Oh! H-hello! I'm Pip. I'm still new here... are you an adventurer too?", ja: "わっ！ こ、こんにちは！ 僕はピップ。まだ新人で…あなたも冒険者？" },
    { en: "Um, hi! You look really brave. I hope I can be strong like you someday!", ja: "えっと、こんにちは！ すごく勇敢そうだね。僕もいつかあなたみたいに強くなれたらな！" },
    { en: "Oh, it's you! Phew, a friendly face. This guild can be a little scary sometimes...", ja: "あっ、君だ！ ふう、優しい人でよかった。このギルド、時々ちょっと怖くて…" },
    { en: "H-hello again! Um, do you have any tips for a rookie like me?", ja: "ま、また会ったね！ えっと、僕みたいな新人にコツを教えてくれない？" },
    { en: "Hi there! I'm trying to be brave today. Talking to you helps. What's up?", ja: "こんにちは！ 今日は勇気を出そうとしてるんだ。君と話すと楽になる。どうしたの？" },
  ],
  restaurant: [
    { en: "Welcome to my restaurant! I'm Tom. Hungry? Today's special is amazing!", ja: "うちのレストランへようこそ！ 俺はトム。腹ペコか？ 今日のおすすめは最高だぜ！" },
    { en: "Ah, a hungry traveler! Sit down. Good food fuels great adventures. What'll you have?", ja: "お、腹をすかせた旅人だな！ さあ座って。うまい飯が冒険の力になる。何にする？" },
    { en: "Welcome back! My kitchen's always busy. Care to hear today's menu?", ja: "おかえり！ 厨房はいつも大忙しだ。今日のメニュー、聞いていくかい？" },
    { en: "Come in, come in! The smell of good cooking says it all. What are you craving?", ja: "入って入って！ うまい料理の匂いが全てを語るだろ。何が食べたい気分だ？" },
    { en: "Hey there! A cook loves a good appetite. What sounds delicious to you?", ja: "よう！ 料理人はいい食欲が大好物だ。何がうまそうに聞こえる？" },
  ],
  bar: [
    { en: "Welcome to the tavern! I'm Sal. Take a seat — drink, rumor, or a good chat?", ja: "酒場へようこそ！ 俺はサル。座りな、酒か、噂話か、それともおしゃべりか？" },
    { en: "Ah, a new face at the bar! Pull up a stool. What's your story, traveler?", ja: "お、バーに新顔だな！ 椅子を引きな。あんたの話を聞かせてくれ、旅人さん。" },
    { en: "Welcome back, friend! The drinks are cold and the talk is free. What's on your mind?", ja: "おかえり、あんた！ 酒は冷えてるし話はタダだ。何か気がかりでも？" },
    { en: "Evening! Nothing beats a good chat over a drink. How's the road treating you?", ja: "よう！ 一杯やりながらのおしゃべりに勝るものはないね。で、旅はどうだい？" },
    { en: "Come on in! I hear all kinds of rumors in here. Want to swap a few stories?", ja: "入んなよ！ ここじゃいろんな噂が耳に入る。話でも交換するか？" },
  ],
  bank: [
    { en: "Welcome to the bank. I'm Greta. Would you like to make a deposit today?", ja: "銀行へようこそ。グレタと申します。本日はご入金ですか？" },
    { en: "Good day. Keeping your gold safe is wise. How may I assist you?", ja: "こんにちは。お金を安全に保管するのは賢明です。ご用件を承ります。" },
    { en: "Hello. A steady saver is a wise adventurer. Is there something I can help with?", ja: "こんにちは。こつこつ貯める人は賢い冒険者です。何かお手伝いできますか？" },
    { en: "Welcome back. Your account is in good order. What can I do for you today?", ja: "おかえりなさいませ。口座は良好です。本日はどのようなご用件でしょう？" },
    { en: "Good day to you. Money managed well grows well. How can I be of service?", ja: "ごきげんよう。上手に管理したお金はよく増えます。どうなさいますか？" },
  ],
  school: [
    { en: "Hello there! I'm Edwin, a teacher. Learning something new today? I'd love to help!", ja: "こんにちは！ 教師のエドウィンです。今日は何か新しいことを学ぶ日かな？ 喜んで手伝うよ！" },
    { en: "Welcome! There's no question too small. What would you like to learn about?", ja: "ようこそ！ どんな小さな質問でも大歓迎だ。何を学びたいのかな？" },
    { en: "Ah, a curious mind! That's the best kind. What's on your mind today?", ja: "お、好奇心のある子だね！ それが一番いい。今日は何を考えているのかな？" },
    { en: "Good to see you again! Every bit of effort counts. What shall we talk about?", ja: "また会えてうれしいよ！ どんな努力も無駄にならない。何について話そうか？" },
    { en: "Hello, student! Practice makes progress, not perfection. How can I help you learn?", ja: "やあ、生徒さん！ 練習は完璧じゃなく前進を生むんだ。学ぶお手伝いをしようか？" },
  ],
  hospital: [
    { en: "Hello. I'm Hale, the town doctor. Are you feeling well today?", ja: "こんにちは。町医者のヘイルです。今日は体調はいかがですか？" },
    { en: "Welcome. Health comes first, always. Is anything troubling you?", ja: "ようこそ。健康が何より大切です。どこか気になるところは？" },
    { en: "Ah, come in. Rest and care heal most things. How are you feeling?", ja: "ああ、どうぞ。休息と手当てでたいていは治ります。気分はどうです？" },
    { en: "Good to see you. Take care of your body — it carries you far. What brings you in?", ja: "お会いできてよかった。体を大事にね、遠くまで運んでくれるのだから。どうされました？" },
    { en: "Hello there. A healthy adventurer is a strong one. Do you need any advice?", ja: "こんにちは。健康な冒険者は強い冒険者です。何か助言が必要ですか？" },
  ],
  church: [
    { en: "Welcome, traveler. I'm Clara. May you find peace here. Is your heart heavy?", ja: "ようこそ旅人さん。シスターのクララです。ここで安らぎを得られますように。心に重いものが？" },
    { en: "Peace be with you. This is a quiet place to rest your soul. What troubles you?", ja: "あなたに平安を。ここは魂を休める静かな場所です。何かお悩みが？" },
    { en: "Hello, dear one. A gentle word can lighten any burden. Would you like to talk?", ja: "こんにちは、いとしい人。優しい一言はどんな重荷も軽くします。お話ししますか？" },
    { en: "Welcome back. The door is always open to you. How does your spirit fare today?", ja: "おかえりなさい。扉はいつもあなたに開かれています。今日、心の調子はいかが？" },
    { en: "Bless you, traveler. Take a moment to breathe. Is there anything on your mind?", ja: "祝福を、旅人さん。少し息をつきましょう。何か心にかかることは？" },
  ],
  salon: [
    { en: "Hi hi! Welcome to my salon! I'm Coco. Ooh, your hair has such potential!", ja: "はいはーい！ サロンへようこそ！ ココよ。おお、あなたの髪、すっごく可能性あるわ！" },
    { en: "Hello, gorgeous! Ready for a new look? Or just here for a fun chat?", ja: "こんにちは、素敵さん！ イメチェンの準備はいい？ それともおしゃべりしに来た？" },
    { en: "Welcome back, darling! My cat missed you, and so did I! What can I do for you?", ja: "おかえり、あなた！ うちの猫も私もあなたに会いたかったの！ どうしてほしい？" },
    { en: "Ooh, hi! Looking fabulous as always. Want to talk hair, fashion, or my cute kitty?", ja: "おお、こんにちは！ 相変わらず素敵ね。髪の話、ファッション、それともうちの可愛い猫の話する？" },
    { en: "Hi there! A great style starts with a smile. What's making you smile today?", ja: "こんにちは！ 素敵なスタイルは笑顔から。で、今日は何があなたを笑顔にしてる？" },
  ],
  police: [
    { en: "Halt — just kidding. I'm Bruno, town guard. All's well? Need directions?", ja: "止まれ…なんてな。町の衛兵ブルーノだ。異常ないか？ 道案内でもいるか？" },
    { en: "Good day, citizen. I keep the peace around here. Is everything all right?", ja: "こんにちは、市民。この辺の平和は俺が守ってる。何も問題ないか？" },
    { en: "Welcome. The town's safe, but the roads outside aren't. Need a warning or two?", ja: "よう。町は安全だが外の道はそうじゃない。忠告のひとつでもいるか？" },
    { en: "Ah, it's you. Staying out of trouble, I hope? What can I do for you?", ja: "お、お前か。厄介ごとには近寄ってないだろうな？ 何か用か？" },
    { en: "Hello there. A watchful guard makes a safe town. Anything you need to report?", ja: "こんにちは。警戒を怠らぬ衛兵が安全な町を作る。何か報告でもあるか？" },
  ],
  florist: [
    { en: "Oh! W-welcome... I'm Lily. These flowers... um, would you like to see them?", ja: "わっ！ い、いらっしゃいませ…リリィです。このお花…えっと、見ていきますか？" },
    { en: "H-hello... The flowers are happy today. I hope they make you smile too.", ja: "こ、こんにちは…お花たちは今日ご機嫌です。あなたも笑顔になれますように。" },
    { en: "Oh, it's you... Um, thank you for coming back. Which flower do you like best?", ja: "あっ、あなた…えっと、また来てくれてありがとうございます。どのお花が一番好きですか？" },
    { en: "Welcome... A kind word makes flowers bloom brighter. Shall we chat?", ja: "いらっしゃい…優しい言葉はお花をもっと綺麗に咲かせるんですよ。少しお話ししますか？" },
    { en: "H-hi... Please take your time. The roses are lovely today. Do you have a favorite?", ja: "こ、こんにちは…ごゆっくりどうぞ。今日はバラが素敵なんです。お気に入りはありますか？" },
  ],
  fish: [
    { en: "Welcome! I'm Finn! Fresh fish today — tuna, sardines, you name it! What'll it be?", ja: "いらっしゃい！ フィンだ！ 今日は新鮮な魚だぞ、マグロにイワシ、なんでもある！ 何にする？" },
    { en: "Hey hey! The catch came in this morning and it's beautiful! Want a look?", ja: "よっ、よっ！ 今朝の水揚げが最高でな！ 見ていくかい？" },
    { en: "Welcome back! Nothing beats fresh fish, I tell ya. What can I get for you today?", ja: "おかえり！ 新鮮な魚に勝るものはないぜ。今日は何にする？" },
    { en: "Ahoy, customer! Fish is brain food, they say. Smart choice coming here! What'd you like?", ja: "よう客人！ 魚は頭にいいって言うだろ。ここに来たのは賢い選択だ！ 何が欲しい？" },
    { en: "Come see the catch of the day! It's practically still swimming. What sounds good?", ja: "今日の水揚げを見てけ！ まだ泳いでそうなくらいピチピチだ。何がいい？" },
  ],
  green: [
    { en: "Welcome! I'm Vera. Fresh veggies and fruit today! What's cooking at your place?", ja: "いらっしゃい！ ヴェラよ。今日は新鮮な野菜と果物があるわ！ おうちで何作るの？" },
    { en: "Hello there! Everything's ripe and ready. Want to know what's in season?", ja: "こんにちは！ どれも食べ頃よ。旬のものが知りたい？" },
    { en: "Welcome back! Eat your greens and stay strong, I always say. What do you need?", ja: "おかえり！ 野菜を食べて元気でいなさい、が私の口癖よ。何が要る？" },
    { en: "Come in, come in! These tomatoes are the best of the bunch. What can I get you?", ja: "さあ入って！ このトマト、今日一番の出来なの。何にする？" },
    { en: "Hi! Good food starts with good ingredients. What are you shopping for today?", ja: "こんにちは！ いい料理はいい素材から。今日は何をお探し？" },
  ],
  meat: [
    { en: "Welcome! I'm Otto. Best meat in town, right here! Planning a feast?", ja: "いらっしゃい！ オットーだ。町一番の肉はここにあるぞ！ ごちそうでも作るのか？" },
    { en: "Ah, a hungry look! Fresh cuts today, perfect for a barbecue. What'll you have?", ja: "お、腹をすかせた顔だな！ 今日は新鮮な肉だ、バーベキューにぴったりだぞ。何にする？" },
    { en: "Welcome back! Meat gives you muscle, and muscle wins fights. What do you need?", ja: "おかえり！ 肉は筋肉を作る、筋肉は戦いに勝つ。今日は何が要る？" },
    { en: "Step up! Nothing makes a meal like good meat. What are you cooking?", ja: "寄ってきな！ いい肉ほど食事を引き立てるものはない。何を作るんだ？" },
    { en: "Hey there! A big appetite deserves a big steak. What sounds good to you?", ja: "よう！ 旺盛な食欲には大きなステーキだ。何がうまそうだ？" },
  ],
  grocery: [
    { en: "Welcome! I'm Marco. Eggs, oil, salt — all your pantry needs right here! What'll it be?", ja: "いらっしゃい！ マルコです。卵に油に塩、台所に必要なものは全部ここに！ 何にします？" },
    { en: "Hi there! Stocking up? I've got a little cooking tip for whatever you buy!", ja: "こんにちは！ 買い出しですか？ 何を買っても、ちょっとした料理のコツを教えますよ！" },
    { en: "Welcome back! The little things make the meal, I always say. What do you need?", ja: "おかえりなさい！ 小さな材料が料理を決める、が私の持論です。何が要りますか？" },
    { en: "Come in! Salt, sugar, soy sauce — the basics matter most. How can I help?", ja: "どうぞ！ 塩、砂糖、しょうゆ、基本こそ大事です。何かお探し？" },
    { en: "Hello! Every great dish starts here on my shelves. What are you cooking today?", ja: "こんにちは！ 素晴らしい料理はみんなこの棚から始まるんです。今日は何を作ります？" },
  ],
  realestate: [
    { en: "Welcome! I'm Estelle. Dreaming of a home of your own? I have wonderful properties!", ja: "ようこそ！ エステルと申します。ご自分の家をお探し？ 素敵な物件がございますよ！" },
    { en: "Hello there! A cozy cottage or a grand manor — which suits you? Let's find out!", ja: "こんにちは！ 居心地のいい小屋か、立派な屋敷か、どちらがお好み？ 一緒に探しましょう！" },
    { en: "Welcome back! Location, comfort, charm — I have it all. What are you looking for?", ja: "おかえりなさい！ 立地、快適さ、魅力、全部揃っています。何をお探しですか？" },
    { en: "Ah, do come in! Everyone deserves a place to call home. Shall I show you around?", ja: "ああ、どうぞお入りください！ 誰もが帰る場所を持つべきです。ご案内しましょうか？" },
    { en: "Good day! The right home changes everything. Tell me about your dream house!", ja: "ごきげんよう！ 理想の家は全てを変えます。あなたの夢のおうちを聞かせて！" },
  ],
  appliance: [
    { en: "Welcome! I'm Den. Fridges, TVs — modern magic for your home! What can I show you?", ja: "いらっしゃい！ デンだよ。冷蔵庫にテレビ、暮らしの魔法をどうぞ！ 何をお見せしようか？" },
    { en: "Hey there! A fridge keeps food fresh, a TV brings the world in. Curious about either?", ja: "やあ！ 冷蔵庫は食べ物を新鮮に、テレビは世界を届ける。どっちか気になる？" },
    { en: "Welcome back! Technology makes life easier, I promise. What are you after today?", ja: "おかえり！ 技術は暮らしを楽にするんだ、本当だよ。今日は何をお探し？" },
    { en: "Come see! These gadgets are the pride of my shop. Want a demonstration?", ja: "見ていって！ この家電たちは店の自慢なんだ。実演してみようか？" },
    { en: "Hi! News, anime, cold drinks — I've got the appliance for it. How can I help?", ja: "こんにちは！ ニュース、アニメ、冷たい飲み物、なんでも家電にお任せ。何かお手伝いは？" },
  ],
};
const LEVEL_GUIDE = {
  500: "Use very simple words and short sentences (around CEFR A2 / TOEIC 500). Avoid difficult vocabulary and complex grammar.",
  700: "Use clear everyday and light business English (around CEFR B1-B2 / TOEIC 700).",
  900: "You may use rich vocabulary, idioms, and natural phrasing (around CEFR C1 / TOEIC 900).",
};
const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    reply_ja: { type: "string" },
    correction: {
      type: "object",
      properties: {
        natural: { type: "boolean" },
        corrected: { type: "string" },
        note_ja: { type: "string" },
      },
      required: ["natural", "corrected", "note_ja"],
      additionalProperties: false,
    },
    quest_flag: { type: "boolean" },
    meaningful: { type: "boolean" },
    fluent: { type: "boolean" },
  },
  required: ["reply", "reply_ja", "correction", "quest_flag", "meaningful", "fluent"],
  additionalProperties: false,
};
// 勉強机(コトハの和文英訳ドリル)用スキーマ
const STUDY_SCHEMA = {
  type: "object",
  properties: {
    feedback_ja: { type: "string" }, // 直前の英訳へのコトハの講評(日本語)。開始時は挨拶。
    correct: { type: "boolean" },    // 直前の英訳が概ね正しいか。開始時は true。
    model_en: { type: "string" },    // 直前の問題の模範英訳。開始時は空文字。
    next_ja: { type: "string" },     // 次に英訳してもらう日本語の問題文。
  },
  required: ["feedback_ja", "correct", "model_en", "next_ja"],
  additionalProperties: false,
};
// 台所(コトハと料理)用スキーマ。効果量(回復/バフ)はscoreから game.js 側で算出する。
const COOK_SCHEMA = {
  type: "object",
  properties: {
    reply_ja: { type: "string" },        // コトハの反応・誘導(日本語・タメ口)
    correction: {                        // 直前のプレイヤー発言の英語添削
      type: "object",
      properties: {
        natural: { type: "boolean" },
        corrected: { type: "string" },
        note_ja: { type: "string" },
      },
      required: ["natural", "corrected", "note_ja"],
      additionalProperties: false,
    },
    done: { type: "boolean" },           // 料理が完成したか
    dish_name_ja: { type: "string" },    // 完成した料理名(done時。それ以外は"")
    score: { type: "integer" },          // 出来栄え0-100(done時。それ以外は0)
    ingredients_used: { type: "array", items: { type: "string" } }, // 使った食材(渡したリストの表記)
    comment_ja: { type: "string" },      // 採点コメント(done時)
  },
  required: ["reply_ja", "correction", "done", "dish_name_ja", "score", "ingredients_used", "comment_ja"],
  additionalProperties: false,
};
function buildSystem(npc, level, questNote) {
  const persona = NPC_PERSONA[npc.id] || NPC_PERSONA.innkeeper;
  const guide = LEVEL_GUIDE[level] || LEVEL_GUIDE[500];
  const shortName = npc.name.split(" ").pop();
  const pname = (window.getPlayerName && window.getPlayerName()) || "";
  const nameLine = (travelerKnown && pname)
    ? `\n- You already know this traveler from before. Their name is "${pname}". Greet them and address them warmly by name ("${pname}") now and then, like an acquaintance you are glad to see again.`
    : "";
  const questLine = questNote
    ? `Set "quest_flag" to true ONLY if ${questNote} In that case, your "reply" should follow that situation. In every other case, set "quest_flag" to false.`
    : `Always set "quest_flag" to false.`;
  return `${persona}

You are an NPC in a classic fantasy RPG town. The person you are talking to is a Japanese learner practicing English conversation with you.

Behavior rules:
- Stay fully in character as ${shortName}. Never break character or mention that you are an AI.${nameLine}
- ${guide}
- Keep every reply to 1-2 short sentences, and usually end by asking the traveler a question so the conversation keeps going.
- If the traveler's message is a stage direction inside parentheses or asterisks (e.g. "(The traveler approaches you.)"), treat it as narration: just greet or react in character, and report the correction as natural with an empty note.
- IMPORTANT: you ONLY understand English. If the traveler's message is NOT in English (for example, it is in Japanese), you genuinely cannot understand it. Your "reply" must, in character and in ENGLISH, politely show that you don't understand and ask them to say it in English — do NOT answer, follow, or translate the content of a non-English message.
- If the message IS in English, gently check it for unnatural or incorrect parts and help them improve.

You MUST answer using the required JSON structure:
- "reply": your in-character response, in ENGLISH only.
- "reply_ja": a natural Japanese translation of your "reply".
- "correction.natural": true if the traveler wrote natural, correct English; false if their English was off OR if they did not write in English at all.
- "correction.corrected": the most natural English way to say what the traveler meant (use this to show them the English even when they wrote in Japanese). If their English was already natural, repeat their sentence as-is.
- "correction.note_ja": a short Japanese explanation (in Japanese). If they wrote in Japanese instead of English, explain that the people of this world only understand English and encourage them to try the English line in "corrected". If their English was just unnatural, explain what to fix. If it was already natural, give brief Japanese praise.
- "quest_flag": ${questLine}
- "meaningful": true if the traveler's latest message is a coherent, relevant contribution that makes sense in the flow of THIS conversation. Set it to false if the message is off-topic, nonsensical, or contradictory given the context, or if it is just a repetitive/monotonous filler that barely advances the conversation.
- "fluent": true if the traveler's latest message is advanced, fluent English (rich vocabulary, correct and complex grammar, natural phrasing). false for simple or broken English, or if it is not English.
Always write "reply_ja" and "note_ja" in Japanese.${questHook && questHook.tone ? "\n\n" + questHook.tone : ""}${(window.getAffectionTone && window.getAffectionTone(npc.id)) ? "\n\n" + window.getAffectionTone(npc.id) : ""}`;
}

// ===== Claude 呼び出し（mode により接続先を切り替え）=====
// ===== トークン使用量の集計（このセッション=ページ読み込みから） =====
const tokenTotals = { input: 0, output: 0, cost: 0 }; // セッション累計
const lastCall = { input: 0, output: 0, cost: 0 };    // 直近1回
function addTokens(u) {
  if (!u) return;
  const inp = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const out = (u.output_tokens || 0);
  const m = curModel();
  const cost = inp * m.in + out * m.out; // その時のモデル料金で計算
  lastCall.input = inp; lastCall.output = out; lastCall.cost = cost;
  tokenTotals.input += inp; tokenTotals.output += out; tokenTotals.cost += cost;
  renderTokenUsage();
}
function renderTokenUsage() {
  const i = tokenTotals.input, o = tokenTotals.output;
  if (!i && !o) {
    const e1 = document.getElementById("token-usage"); if (e1) e1.textContent = "";
    const e2 = document.getElementById("chat-tokens"); if (e2) e2.textContent = "";
    return;
  }
  const line = (lab, a, b, c) => `${lab} 入力 ${a.toLocaleString()}・出力 ${b.toLocaleString()}（約 $${c.toFixed(4)}）`;
  const txt = `${line("今回", lastCall.input, lastCall.output, lastCall.cost)} ／ ${line("累計", i, o, tokenTotals.cost)}`;
  const a = document.getElementById("token-usage"); if (a) a.textContent = txt;
  const b = document.getElementById("chat-tokens"); if (b) b.textContent = txt;
}

// 低レベル: 接続先を切り替えて Anthropic にPOSTし、生レスポンスを返す
async function postClaude(body) {
  let url, headers;
  if (AI_CONFIG.mode === "proxy") {
    if (!AI_CONFIG.proxyUrl) throw { code: "no_proxy" };
    url = AI_CONFIG.proxyUrl;
    headers = { "content-type": "application/json" };
  } else {
    const key = getApiKey();
    if (!key) throw { code: "no_key" };
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": AI_CONFIG.apiVersion,
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!r.ok) {
    let detail = "";
    try { detail = await r.text(); } catch {}
    throw { code: "http_" + r.status, status: r.status, detail };
  }
  const data = await r.json();
  if (data && data.usage) addTokens(data.usage);
  return data;
}

// 町人との英会話(構造化出力: reply/添削/和訳/quest_flag)
async function callClaude(npc, level, messages) {
  const body = {
    model: AI_CONFIG.model,
    max_tokens: AI_CONFIG.maxTokens,
    system: buildSystem(npc, level, questHook && questHook.note),
    messages,
  };
  const oc = outputConfig(true); if (oc) body.output_config = oc;
  const data = await postClaude(body);
  if (data.stop_reason === "refusal") {
    return { reply: "...", reply_ja: "（うまく答えられないようだ）", correction: { natural: true, corrected: "", note_ja: "" }, quest_flag: false, meaningful: true, fluent: false };
  }
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) throw { code: "no_text" };
  return JSON.parse(block.text);
}

// 相棒コトハに相談(日本語で回答する素のテキスト)
function buildKotohaSystem(level, context) {
  const lv = level === 900 ? "上級" : level === 700 ? "中級" : "初級";
  const pname = (window.getPlayerName && window.getPlayerName()) || "";
  const nameLine = pname ? `主人公の名前は「${pname}」。相棒として、ときどき名前で呼びかけてね。\n` : "";
  return `あなたは「コトハ」。幼い女の子の姿をした言葉の精霊で、主人公(日本語話者・英語学習中／レベルは${lv})の相棒です。
この世界の住人は英語しか話さない異世界。主人公だけがあなたを見て、日本語で話せます。
${nameLine}
性格と話し方:
- 明るく元気で面倒見がいい。幼いけれどちょっとお姉さんぶる。語学にとても詳しい。
- 返事は必ず日本語。幼い女の子らしい親しみやすいタメ口で、簡潔に(2〜5文ほど)。相手を決して責めず励ます。

あなたの役割(相談に答える):
1. 「英語でどう言えばいい?」→ 自然な英語表現を教える。英語フレーズは "..." で囲み、意味や使い方を日本語で添える。
2. 町の人の英語や単語の意味を、やさしく解説する。
3. 冒険で困ったとき→ 世界観に沿ってヒントを出す(答えを全部は言わず、背中を押す)。
${context ? `\n参考: 主人公のいまの目的は「${context}」。これに沿ってヒントを出してね。` : ""}`;
}
async function callKotoha(level, context, messages, maxTokens) {
  const body = {
    model: AI_CONFIG.model,
    max_tokens: maxTokens || AI_CONFIG.maxTokens,
    system: buildKotohaSystem(level, context),
    messages,
  };
  const oc = outputConfig(false); if (oc) body.output_config = oc;
  const data = await postClaude(body);
  if (data.stop_reason === "refusal") return "（…うまく答えられないみたい。ごめんね）";
  const block = (data.content || []).find((b) => b.type === "text");
  return block ? block.text : "（うまく聞こえなかったみたい）";
}

// ===== 勉強机: コトハの和文英訳ドリル(出題→英訳→添削→次の問題) =====
// 学習テーマ(ランダム+英文法テーマ)。note は出題方針としてシステムプロンプトに渡す。
const STUDY_THEMES = [
  { id: "random",      label: "🎲 ランダム",     note: "文法項目を限定せず、いろいろな文型・時制をバランスよく混ぜて出題する。" },
  { id: "present",     label: "現在形",          note: "現在形(習慣・一般的な事実)を主に使う文を中心に出題する。" },
  { id: "past",        label: "過去形",          note: "過去形(過去の出来事)を主に使う文を中心に出題する。" },
  { id: "future",      label: "未来形",          note: "未来表現(will / be going to)を主に使う文を中心に出題する。" },
  { id: "progressive", label: "進行形",          note: "現在進行形・過去進行形を主に使う文を中心に出題する。" },
  { id: "perfect",     label: "完了形",          note: "現在完了・過去完了(継続/経験/完了/結果)を主に使う文を中心に出題する。" },
  { id: "modal",       label: "助動詞",          note: "助動詞(can / must / should / may / might / have to など)を主に使う文を中心に出題する。" },
  { id: "subjunctive", label: "仮定法・条件文",  note: "if条件文や仮定法過去・仮定法過去完了を主に使う文を中心に出題する。" },
  { id: "passive",     label: "受動態",          note: "受動態(be + 過去分詞)を主に使う文を中心に出題する。" },
  { id: "infgerund",   label: "不定詞・動名詞",  note: "to不定詞・動名詞(名詞用法/目的/動詞の目的語など)を主に使う文を中心に出題する。" },
  { id: "participle",  label: "分詞・分詞構文",  note: "分詞(現在分詞/過去分詞の修飾)や分詞構文を主に使う文を中心に出題する。" },
  { id: "pattern5",    label: "5文型",           note: "英語の5文型(SV/SVC/SVO/SVOO/SVOC)を意識した文を中心に出題する。特にSVOOやSVOCを織り交ぜる。" },
  { id: "relative",    label: "関係詞",          note: "関係代名詞(who/which/that)や関係副詞を主に使う文を中心に出題する。" },
  { id: "comparison",  label: "比較",            note: "比較級・最上級・as ~ as を主に使う文を中心に出題する。" },
  { id: "preposition", label: "前置詞",          note: "前置詞(at/in/on/by/for/with など)の使い分けが要点になる文を中心に出題する。" },
  { id: "conjunction", label: "接続詞",          note: "接続詞(when/because/although/so/if など)で節をつなぐ文を中心に出題する。" },
  { id: "question",    label: "疑問文・否定文",  note: "疑問文(Wh疑問・Yes/No疑問)や否定文の作り方が要点になる文を中心に出題する。" },
];
// 出題のマンネリ防止: 開始メッセージに毎回ちがう話題ヒント＋シードを混ぜる
const STUDY_TOPICS = [
  "天気", "買い物", "旅行", "料理", "仕事", "学校の授業", "趣味", "スポーツ観戦",
  "家族", "友達との約束", "ペット", "音楽", "映画やドラマ", "健康・体調", "季節の行事",
  "電車やバスの移動", "レストランでの食事", "週末の予定", "引っ越し", "誕生日パーティー",
  "読書", "ガーデニング", "海や山でのレジャー", "カフェ", "病院・通院", "スマホやパソコン",
  "会議やプレゼン", "家電の買い替え", "お祭り", "掃除や片付け", "アルバイト", "貯金やお金",
  "道案内", "ホテルの予約", "写真を撮ること", "アプリの使い方", "近所の人との会話",
  "在宅ワーク", "子どもの世話", "料理のレシピ", "天体観測", "キャンプ",
];
function randomStudyStarter() {
  const shuffled = STUDY_TOPICS.slice().sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, 3).join("・");
  const seed = Math.floor(Math.random() * 1e6);
  return `(レッスンを始めて。最初の問題を出して。今回はできれば「${picks}」のような話題から選んで、いつもと違う新鮮な文にしてね。#${seed})`;
}
function buildStudySystem(level, theme) {
  const guide = level === 900
    ? `TOEIC900・上級(CEFR C1相当)。しっかり手応えのある英作文にする。
   - 1文あたり15〜25語程度の長めで内容のある文。
   - 関係詞・分詞構文・仮定法・接続詞による複文/重文、抽象的・ビジネス/時事的な話題を積極的に使う。
   - 高度な語彙やコロケーション、受動態・完了形・無生物主語など、英訳に工夫が要る構造を含める。
   - 例:「来期の業績が改善しなければ、経営陣は事業の一部を売却せざるを得ないだろう。」「彼女が提案した計画は、コストを抑えつつ生産性を高めるという点で画期的だった。」`
    : level === 700
    ? `TOEIC700・中級(CEFR B1-B2相当)。日常・ビジネスでよく使う、少しひねりのある文。
   - 1文あたり10〜16語程度。
   - 接続詞や関係詞を使った複文、未来・現在完了・助動詞・比較などを織り交ぜる。
   - 例:「会議が長引いたので、私たちは昼食を食べる時間がありませんでした。」「もし明日雨が降ったら、イベントは延期されます。」`
    : `TOEIC500・初級(CEFR A2相当)。短くやさしい基本文。
   - 1文あたり5〜9語程度。
   - 現在・過去の基本時制、be動詞・一般動詞、身近で具体的な話題。複雑な構文は避ける。
   - 例:「私は毎朝コーヒーを飲みます。」「彼女は昨日、新しい靴を買いました。」`;
  const pname = (window.getPlayerName && window.getPlayerName()) || "";
  return `あなたは「コトハ」。幼い女の子の姿をした言葉の精霊で、主人公${pname ? `(${pname})` : ""}の英語学習の相棒です。いまは勉強机で「和文英訳ドリル」の先生をしています。

進め方:
1. あなたは日本語の短い文を1つ出題します(next_ja)。主人公はそれを英語に訳して送ります。
2. 次のターンでは、直前にあなたが出した日本語文に対する主人公の英訳を評価します。
   - 概ね正しく自然なら correct=true。文法ミスや不自然さ・意味のズレがあれば correct=false。
   - feedback_ja: 日本語で短く優しい講評(褒める/どこをどう直すか)。決して責めず励ます、幼い女の子の親しみやすいタメ口。
   - model_en: その日本語文の自然な模範英訳を1つ。
3. つづけて新しい日本語文を next_ja に入れて出題します。これを繰り返します。

出題する日本語文の難易度(必ずこのレベルに合わせ、これより簡単にしない):
${guide}
${theme && theme.id !== "random" ? `\n今回の学習テーマ: 「${theme.label}」。${theme.note}\n- 出題する日本語文は、英訳するとこのテーマの文法が自然に必要になるように作る。テーマから外れた文は出さない。` : `\n今回の学習テーマ: ランダム。${(theme && theme.note) || "いろいろな文型・時制をバランスよく出題する。"}`}
- 出題は1文ずつ。毎回ちがう話題でバリエーションを出す。
- next_ja は必ず日本語。model_en と評価する対象は英語。
- 模範英訳 model_en も、このレベルにふさわしい自然で適切な難度の英語にする。
- 主人公が日本語のまま答えた場合は correct=false にして、英語で書くようやさしく促す。

最初のターン(主人公がまだ何も英訳していないとき)は、feedback_ja に短い挨拶、correct=true、model_en は空文字、next_ja に最初の問題を入れてください。`;
}
async function callClaudeStudy(level, messages, theme) {
  const body = {
    model: AI_CONFIG.model,
    max_tokens: AI_CONFIG.maxTokens,
    system: buildStudySystem(level, theme),
    messages,
  };
  const oc = outputConfigWith(STUDY_SCHEMA); if (oc) body.output_config = oc;
  const data = await postClaude(body);
  if (data.stop_reason === "refusal") {
    return { feedback_ja: "（…うまく出せないみたい。ごめんね）", correct: true, model_en: "", next_ja: "今日はとてもいい天気です。" };
  }
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) throw { code: "no_text" };
  return JSON.parse(block.text);
}

// ===== 台所: コトハと料理(英語で手順を指示→完成・採点→効果つき料理) =====
// AIプロンプトに載せる食材/素材リスト(トークン節約のため最大24種で要約)
const AI_LIST_MAX = 24;
function capListForPrompt(names) {
  if (!names || !names.length) return "";
  if (names.length <= AI_LIST_MAX) return names.join("、");
  return names.slice(0, AI_LIST_MAX).join("、") + `、（ほか${names.length - AI_LIST_MAX}種・主人公が名前を言えば使える）`;
}
function buildCookSystem(level, ingredients) {
  const pname = (window.getPlayerName && window.getPlayerName()) || "";
  const list = (ingredients && ingredients.length) ? capListForPrompt(ingredients) : "(手持ちの食材なし)";
  return `あなたは「コトハ」。幼い女の子の姿をした言葉の精霊で、主人公${pname ? `(${pname})` : ""}の料理の相棒です。いまは台所で、主人公の英語の調理指示を受けて一緒に料理しています。

進め方:
- 主人公は英語で調理の手順を指示します。あなたは reply_ja に日本語(幼い女の子の親しみやすいタメ口)で、反応・あいづち・次の手順への誘導を2〜4文で書きます。
- 手持ちの食材(一部): ${list}。使えるのは【この手持ちリストにある食材だけ】です。リストにない食材(例: 小麦粉・鶏肉など、持っていない物)は使えません。指示されても reply_ja で「それは持ってないよ」とやさしく伝え、リストにある食材で代用を促し、done=false にします。
- 【重要】手持ちの食材が「(手持ちの食材なし)」のとき、またはリストにある食材を1つも使っていないときは、絶対に done=true にしないでください(料理は完成しません)。まず食材が必要だと伝え、done=false のままにします。
- 数ターンやりとりして、主人公が「完成/できた/これで終わり(I'm done など)」と示すか、十分な手順がそろい【かつ手持ちリストの食材を1つ以上使っている】なら done=true にして料理を完成させます。
- done=true のとき: dish_name_ja に料理名(日本語)、score(0-100)に出来栄え、ingredients_used に実際に使った食材(渡したリストの表記そのまま。例「マグロ×1」なら「マグロ」)、comment_ja に短い採点コメント(日本語)を入れる。
  - 出来栄えscoreは「手順の丁寧さ・食材の活かし方」に加えて、特に【英語で調理指示できたか】を重視して評価する。
  - 調理の手順を英語で言えていない場合(日本語やローマ字、単語の羅列だけなど)は score を大きく下げる。ほとんど英語を使っていなければ 30点以下にする。
  - 英語が自然で流暢なほど score を上げる(語彙が豊か・文法が正確・調理動詞 chop/boil/grill/season などを的確に使えている)。とても流暢なら 85点以上もありえる。
  - comment_ja では、英語の良かった点や次に英語でどう言うとよいかも一言そえる。
- done=false のとき: dish_name_ja="", score=0, ingredients_used=[], comment_ja="" にする。
- 主人公が日本語で指示してきたら、reply_ja でやさしく「英語で手順を教えてね」と促す。
- reply_ja は必ず日本語で書く。

毎ターン、直前の主人公の発言の英語を添削して correction に入れる:
- correction.natural: 自然で正しい英語なら true。英語が不自然/間違い、または英語でない場合は false。
- correction.corrected: 主人公が言いたかったことの最も自然な英語の言い方。すでに自然ならその文をそのまま。日本語で言ってきた場合も、その内容を英語にした文を入れる。
- correction.note_ja: 短い日本語の説明。日本語で言ってきたら英語で言うよう促し corrected の英文を勧める。英語が不自然なら直し方を、自然なら短くほめる。
（挨拶や合図だけの最初のターンなど英訳が不要なときは natural=true, corrected="", note_ja="" でよい）`;
}
// 召喚料理: モンスターの素材で「架空の料理(貢物)」を作る
function buildSummonCookSystem(level, ingredients) {
  const pname = (window.getPlayerName && window.getPlayerName()) || "";
  const list = (ingredients && ingredients.length) ? capListForPrompt(ingredients) : "(手持ちの素材なし)";
  return `あなたは「コトハ」。幼い女の子の姿をした言葉の精霊で、主人公${pname ? `(${pname})` : ""}の相棒です。いまは大きな邸宅の「召喚料理のキッチン」で、モンスターから得た素材を使って、召喚儀式の“貢物(そなえもの)”となる料理を一緒に作っています。

進め方:
- 手持ちの素材(一部): ${list}。主人公が持っている素材を英語で言えば、上のリストに無くても使ってよい(ingredients_used にその名前をそのまま入れる)。明らかに手元になさそうな架空の素材を言われたら reply_ja で「それは持ってないよ」と伝え done=false にします。
- 主人公は英語で調理手順を指示します。reply_ja には日本語(幼い女の子のタメ口)で反応・誘導を2〜4文。
- 数ターンで主人公が「完成(I'm done など)」と示すか十分な手順が揃ったら done=true。
- done=true のとき: dish_name_ja に、その素材と手順から想像した“架空の料理名(かっこいい/おいしそう/少し不気味など創作OK)”を日本語で命名。score(0-100)は出来栄え。ingredients_used に使った素材(リストの表記そのまま)。comment_ja に短い講評。
  - score は「英語で調理指示できたか」を重視。ほとんど英語でなければ30点以下、自然で流暢なほど高く(とても流暢なら85点以上)。
- done=false のとき: dish_name_ja="", score=0, ingredients_used=[], comment_ja="" 。
- reply_ja は必ず日本語。
毎ターン、直前の主人公の英語を correction に添削(natural / corrected / note_ja)。合図だけのターンは natural=true, corrected="", note_ja="" 。`;
}
async function callClaudeCook(level, messages, ingredients, variant) {
  const body = {
    model: AI_CONFIG.model,
    max_tokens: AI_CONFIG.maxTokens,
    system: (variant === "summon" ? buildSummonCookSystem : buildCookSystem)(level, ingredients),
    messages,
  };
  const oc = outputConfigWith(COOK_SCHEMA); if (oc) body.output_config = oc;
  const data = await postClaude(body);
  if (data.stop_reason === "refusal") {
    return { reply_ja: "（…うまく作れないみたい。ごめんね）", correction: { natural: true, corrected: "", note_ja: "" }, done: false, dish_name_ja: "", score: 0, ingredients_used: [], comment_ja: "" };
  }
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) throw { code: "no_text" };
  return JSON.parse(block.text);
}

// ===== 召喚魔法陣: 貢物を捧げ、英語の詠唱で召喚獣カードを得る =====
const CAST_SCHEMA = {
  type: "object",
  properties: {
    reply_ja: { type: "string" },
    correction: {
      type: "object",
      properties: { natural: { type: "boolean" }, corrected: { type: "string" }, note_ja: { type: "string" } },
      required: ["natural", "corrected", "note_ja"], additionalProperties: false,
    },
    done: { type: "boolean" },                 // 召喚が成立したか
    beast_name_ja: { type: "string" },         // 架空の召喚獣名(done時)
    element: { type: "string", enum: ["fire", "water", "wind", "earth", "light", "dark"] }, // 属性
    incantation_quality: { type: "integer" },  // 詠唱(英語)の出来 0-100
    flavor_ja: { type: "string" },             // 召喚獣の一言説明(done時)
  },
  required: ["reply_ja", "correction", "done", "beast_name_ja", "element", "incantation_quality", "flavor_ja"],
  additionalProperties: false,
};
function buildCastSystem(level, tributeName) {
  const pname = (window.getPlayerName && window.getPlayerName()) || "";
  return `あなたは「コトハ」。幼い女の子の姿をした言葉の精霊で、主人公${pname ? `(${pname})` : ""}の相棒です。いまは大きな邸宅の「召喚魔法陣」の前。主人公は貢物「${tributeName || "料理"}」を捧げ、英語で召喚の“詠唱(呪文)”を唱えて召喚獣を呼び出そうとしています。

進め方:
- reply_ja には日本語(幼い女の子のタメ口)で、儀式の様子や励ましを2〜4文。
- 主人公が英語で召喚の呼びかけを唱えます。難しく考えず、簡単な英語でOK。
- 判定はやさしめに: 召喚を呼ぶ意図の英語であれば done=true にして成立させる。短くてもよい(例 "Come, dragon!" / "I summon you!" / "Appear, water spirit!" など1〜数語でもOK)。1回の発言で成立させてあげる。
  - 英語がまったく無い(日本語だけ)、または召喚と無関係な内容のときだけ done=false にして、reply_ja でやさしく「英語でひとこと呼びかけてみて！(例: Come, dragon!)」と促す。
- done=true のとき:
  - beast_name_ja: 架空の召喚獣の名前を日本語で創作(貢物や詠唱の雰囲気に合わせる)。
  - element: 貢物「${tributeName}」や詠唱の言葉から連想される属性を fire/water/wind/earth/light/dark から1つ。
  - incantation_quality(0-100): 詠唱の英語の出来。簡単でも成立はするが、短い/簡単なら低め、語彙豊かで流暢・雰囲気があるほど高い(とても良ければ85以上)。※これはレアリティに影響するだけで、成立の可否には関係しない。
  - flavor_ja: その召喚獣の短い一言説明。
- done=false のとき: beast_name_ja="", element="fire", incantation_quality=0, flavor_ja="" 。
- reply_ja は必ず日本語。
毎ターン、直前の主人公の英語を correction に添削(natural / corrected / note_ja)。合図だけのターンは natural=true, corrected="", note_ja="" 。`;
}
async function callClaudeCast(level, messages, tributeName) {
  const body = {
    model: AI_CONFIG.model,
    max_tokens: AI_CONFIG.maxTokens,
    system: buildCastSystem(level, tributeName),
    messages,
  };
  const oc = outputConfigWith(CAST_SCHEMA); if (oc) body.output_config = oc;
  const data = await postClaude(body);
  if (data.stop_reason === "refusal") {
    return { reply_ja: "（…うまく召喚できないみたい）", correction: { natural: true, corrected: "", note_ja: "" }, done: false, beast_name_ja: "", element: "fire", incantation_quality: 0, flavor_ja: "" };
  }
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) throw { code: "no_text" };
  return JSON.parse(block.text);
}

// ===== テレビ: AI放送(ニュース/アニメ/バラエティ)。一方通行・チャンネル変更のみ =====
const TV_CHANNELS = { news: "ニュース", anime: "アニメ", variety: "バラエティ" };
const TV_SCHEMA = {
  type: "object",
  properties: { title_ja: { type: "string" }, program_en: { type: "string" }, program_ja: { type: "string" } },
  required: ["title_ja", "program_en", "program_ja"],
  additionalProperties: false,
};
function buildTvSystem(level, channel) {
  const guide = LEVEL_GUIDE[level] || LEVEL_GUIDE[500];
  const kind = channel === "anime" ? "a lively, dramatic scene or line from a fantasy anime show"
    : channel === "variety" ? "a cheerful segment from a fun variety/quiz show (a host speaking to the audience)"
    : "a short news report about the fantasy world (adventurers, towns, monsters, weather)";
  return `You are a TV broadcast in a fantasy world (the "${TV_CHANNELS[channel] || "ニュース"}" channel). Produce ${kind}.
- ${guide}
- Write 2-4 short natural English sentences as the broadcast (program_en). It is a ONE-WAY broadcast: never address the viewer directly, never ask the viewer questions.
- Give a short Japanese program title (title_ja) and a natural Japanese translation of the broadcast (program_ja).
- Make each broadcast fresh and different.`;
}
async function callClaudeTv(level, channel, prev) {
  const userMsg = prev
    ? `Continue the same ${channel} program. Here is the previous part:\n"${prev}"\nBroadcast the NEXT part (a natural continuation of the same story/report/scene).`
    : `Broadcast the ${channel} channel now.`;
  const body = {
    model: AI_CONFIG.model, max_tokens: AI_CONFIG.maxTokens,
    system: buildTvSystem(level, channel),
    messages: [{ role: "user", content: userMsg }],
  };
  const oc = outputConfigWith(TV_SCHEMA); if (oc) body.output_config = oc;
  const data = await postClaude(body);
  if (data.stop_reason === "refusal") return { title_ja: "放送休止", program_en: "We are having some technical difficulties.", program_ja: "（ただいま放送を休止しています）" };
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) throw { code: "no_text" };
  return JSON.parse(block.text);
}

// ※ ギルド依頼はAI自動生成を廃止し、事前定義リスト(quests.js の QUEST_POOL)から
//    ランダム出題する方式に変更しました(game.js の pickQuestsFromPool)。

// =====================================================================
// 会話オーバーレイ
// =====================================================================
const Chat = (() => {
  let opened = false;
  let npc = null, level = 500, onCloseCb = null;
  let history = [];
  let busy = false;
  let pendingStart = false; // キー入力待ちで開始を保留中か
  let convMode = "npc";     // "npc"(町人と英会話) | "kotoha"(相談) | "study"(英訳ドリル) | "cook"(料理)
  let kotohaContext = null; // コトハに渡す現在の目的など
  let studyTheme = null;    // 勉強机ドリルで選択中の学習テーマ
  let cookIngredients = []; // 料理で使える手持ち食材
  let cookOnResult = null;  // 料理完成時のコールバック(game.js)
  let cookDone = false;     // 料理が完成済みか
  let cookVariant = "normal"; // "normal"(食料品) | "summon"(召喚料理)
  let castTribute = "";     // 召喚で捧げた貢物の名前
  let castOnResult = null;  // 召喚成立時のコールバック(game.js)
  let castDone = false;     // 召喚が成立済みか
  let tvChannel = "";       // テレビの現在チャンネル(続きを見る用)
  let tvLastProgram = "";   // 直前の放送内容(続きの生成に渡す)
  let sendLabel = "話す";
  let suspended = null;     // NPC会話を退避してコトハに切替えた時の保存先

  const overlay = document.getElementById("chat-overlay");
  const logEl = document.getElementById("chat-log");
  const nameEl = document.getElementById("chat-npc-name");
  const inputEl = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const closeBtn = document.getElementById("chat-close");
  const keyBtn = document.getElementById("chat-key");
  const helpBtn = document.getElementById("chat-help");
  const inputBar = document.getElementById("chat-inputbar");
  const keyPanel = document.getElementById("chat-apikey");
  const keyInput = document.getElementById("apikey-input");
  const keySave = document.getElementById("apikey-save");
  const keyCancel = document.getElementById("apikey-cancel");

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function scrollBottom() { logEl.scrollTop = logEl.scrollHeight; }

  function addNpcLine(reply, replyJa) {
    const row = el("div", "chat-row npc");
    const bubble = el("div", "bubble npc-bubble");
    bubble.appendChild(el("span", "bubble-text", reply));

    const ja = el("div", "ja-text", replyJa);
    ja.style.display = "none";
    const exp = el("div", "exp-text");
    exp.style.display = "none";

    const btns = el("div", "bubble-btns");
    // 訳ボタン
    const trBtn = el("button", "tr-btn", "🔍 コトハに訳を聞く");
    trBtn.addEventListener("click", () => {
      const show = ja.style.display === "none";
      ja.style.display = show ? "block" : "none";
      trBtn.textContent = show ? "🔼 訳をかくす" : "🔍 コトハに訳を聞く";
    });
    // 解説ボタン(押すとコトハが詳しく解説)
    let expLoaded = false, expLoading = false;
    const exBtn = el("button", "tr-btn exp-btn", "📖 コトハに解説してもらう");
    exBtn.addEventListener("click", async () => {
      if (expLoading) return;
      if (expLoaded) {
        const show = exp.style.display === "none";
        exp.style.display = show ? "block" : "none";
        exBtn.textContent = show ? "🔼 解説をかくす" : "📖 コトハに解説してもらう";
        return;
      }
      expLoading = true; exBtn.textContent = "📖 コトハが考え中…";
      try {
        exp.textContent = await callExplain(reply);
        exp.style.display = "block";
        expLoaded = true; exBtn.textContent = "🔼 解説をかくす";
      } catch (err) {
        exp.textContent = "⚠ " + errorMessage(err);
        exp.style.display = "block";
        exBtn.textContent = "📖 もう一度解説";
      } finally { expLoading = false; scrollBottom(); }
    });
    btns.appendChild(trBtn); btns.appendChild(exBtn);
    // 返し方のヒント(町人との会話のときだけ)。押すとコトハが英語での返事の例を教えてくれる。
    const rh = el("div", "exp-text"); rh.style.display = "none";
    if (convMode === "npc") {
      let rhLoaded = false, rhLoading = false;
      const rhBtn = el("button", "tr-btn hint-btn", "💬 返し方のヒント");
      rhBtn.addEventListener("click", async () => {
        if (rhLoading) return;
        if (rhLoaded) { const show = rh.style.display === "none"; rh.style.display = show ? "block" : "none"; rhBtn.textContent = show ? "🔼 ヒントをかくす" : "💬 返し方のヒント"; return; }
        rhLoading = true; rhBtn.textContent = "💬 コトハが考え中…";
        try { rh.textContent = await callReplyHint(reply); rh.style.display = "block"; rhLoaded = true; rhBtn.textContent = "🔼 ヒントをかくす"; }
        catch (err) { rh.textContent = "⚠ " + errorMessage(err); rh.style.display = "block"; rhBtn.textContent = "💬 もう一度ヒント"; }
        finally { rhLoading = false; scrollBottom(); }
      });
      btns.appendChild(rhBtn);
    }
    if (window.Voice) Voice.attachSpeakButton(btns, reply, "en"); // 🔊聞く(voice.js。無ければ無効)
    bubble.appendChild(btns);

    row.appendChild(bubble);
    row.appendChild(ja);
    row.appendChild(exp);
    row.appendChild(rh);
    logEl.appendChild(row);
    scrollBottom();
    if (window.Voice) Voice.autoSpeak(reply, "en"); // 自動読み上げ(ONのときのみ)
  }
  // 町人のセリフに英語でどう返すかのヒント(返事の例＋表現)
  async function callReplyHint(npcReply) {
    return callKotoha(level, null, [{
      role: "user",
      content: `町の人にこう言われたよ：「${npcReply}」。これに英語でどう返せばいい？ 返事の例を1〜2個(英語フレーズ)と、使える単語・表現を、英語初心者の私にやさしく日本語で短く教えて。丸暗記じゃなく自分で言えるようにヒントにして。** などの記号装飾は使わないで。`,
    }], 600);
  }

  // コトハに英文を詳しく解説してもらう(その文専用の単発リクエスト)
  async function callExplain(en) {
    return callKotoha(level, null, [{
      role: "user",
      content: `次の英文を、英語初心者の私にやさしく詳しく解説して。意味・使われている単語・文法のポイント・どんな場面で使うかも教えてね。読みやすく改行してOKだけど、** などの記号装飾は使わないでね：\n"${en}"`,
    }], 1500); // 解説は長くなりがちなので上限を多めに(途中で切れないように)
  }
  // 勉強机: 出題された日本語文を英訳するためのヒント(完成英文は出さない)
  async function callStudyHint(ja, lv) {
    return callKotoha(lv, null, [{
      role: "user",
      content: `次の日本語を英語に訳すための「ヒント」を、英語学習中の私に教えて。完成した英文そのものは絶対に書かないでね。使えそうな英単語や言い回しを2〜4個、それと文の組み立て方(時制や構文のポイント)を、日本語で短く。** などの記号装飾は使わないでね：\n「${ja}」`,
    }], 500);
  }
  // 料理: いまの会話の流れをふまえたアドバイス(次の手順＋英語での言い方)
  async function callCookHint() {
    const list = (cookIngredients && cookIngredients.length) ? cookIngredients.join("、") : (cookVariant === "summon" ? "(素材なし)" : "(食材なし)");
    const noun = cookVariant === "summon" ? "召喚料理(モンスターの素材で作る貢物)" : "料理";
    // これまでのやりとり(直近数ターン)をまとめて渡す→続きの手順をアドバイスできる
    const convo = history.slice(-6).map((m) => {
      if (m.role === "user") return "私: " + m.content;
      try { const o = JSON.parse(m.content); return "コトハ: " + (o.reply_ja || ""); } catch (_) { return "コトハ: " + m.content; }
    }).join("\n");
    return callKotoha(level, null, [{
      role: "user",
      content: `いま${noun}を作っている途中だよ。手持ち: ${list}。\nこれまでのやりとり:\n${convo}\n\nこの続きのアドバイスをちょうだい。① 次にどんな手順をすればいいか(調理の進め方)を1〜2個、② それを英語でどう言えばいいか(例フレーズ1〜2個＋使える調理動詞や単語: chop, boil, grill, fry, season, mix, add など)を、英語初心者の私にやさしく日本語で短く教えて。完成英文の丸暗記ではなく、自分で英語を組み立てられるヒントにして。** などの記号装飾は使わないでね。`,
    }], 700);
  }
  function addPlayerLine(text) {
    const row = el("div", "chat-row me");
    row.appendChild(el("div", "bubble me-bubble", text));
    logEl.appendChild(row);
    scrollBottom();
  }
  function addCorrection(c) {
    if (!c) return;
    if (c.natural) {
      const box = el("div", "correction ok");
      box.appendChild(el("div", "corr-title", "✓ コトハ：自然な英語！"));
      if (c.note_ja) box.appendChild(el("div", "corr-note", c.note_ja));
      logEl.appendChild(box);
    } else {
      const box = el("div", "correction fix");
      box.appendChild(el("div", "corr-title", "✏️ コトハの添削"));
      if (c.corrected) {
        const line = el("div", "corr-fixed");
        line.appendChild(el("span", "corr-label", "→ "));
        line.appendChild(el("span", "corr-eng", c.corrected));
        box.appendChild(line);
      }
      if (c.note_ja) box.appendChild(el("div", "corr-note", c.note_ja));
      logEl.appendChild(box);
    }
    scrollBottom();
  }
  function addInfo(text) { logEl.appendChild(el("div", "chat-info", text)); scrollBottom(); }

  // コトハの返事(日本語の素テキスト。和訳ボタンなし)
  function addKotohaLine(text) {
    const row = el("div", "chat-row npc");
    const bubble = el("div", "bubble npc-bubble");
    bubble.appendChild(el("span", "bubble-text", text));
    row.appendChild(bubble);
    logEl.appendChild(row);
    scrollBottom();
  }

  // 勉強机: 学習テーマの選択画面(ドリル開始前)
  function addThemePicker() {
    const box = el("div", "theme-pick");
    box.appendChild(el("div", "theme-pick-title", "📚 今日のテーマを選んでね"));
    const grid = el("div", "theme-grid");
    for (const t of STUDY_THEMES) {
      const b = el("button", "theme-btn" + (t.id === "random" ? " theme-random" : ""), t.label);
      b.addEventListener("click", () => {
        if (busy) return;
        studyTheme = t;
        logEl.innerHTML = ""; // テーマ選択を消してドリル開始
        addInfo(`コトハ「テーマは『${t.label}』だね！ 日本語の文を英語にしてみてね。」`);
        history = [];
        history.push({ role: "user", content: randomStudyStarter() });
        turn(true);
      });
      grid.appendChild(b);
    }
    box.appendChild(grid);
    logEl.appendChild(box); scrollBottom();
  }

  // テレビ: チャンネル選択ボタン(直前のチャンネルがあれば「続きを見る」も)
  function addTvChannels() {
    const box = el("div", "theme-pick");
    box.appendChild(el("div", "theme-pick-title", "📺 チャンネルを選んでね"));
    const grid = el("div", "theme-grid");
    if (tvChannel) { // 続きを見る(同じチャンネルの続き)
      const cb = el("button", "theme-btn theme-random", `▶ 続きを見る（${TV_CHANNELS[tvChannel]}）`);
      cb.addEventListener("click", () => { if (!busy) tvWatch(tvChannel, true); });
      grid.appendChild(cb);
    }
    for (const key of Object.keys(TV_CHANNELS)) {
      const b = el("button", "theme-btn", TV_CHANNELS[key]);
      b.addEventListener("click", () => { if (!busy) tvWatch(key, false); });
      grid.appendChild(b);
    }
    box.appendChild(grid);
    logEl.appendChild(box); scrollBottom();
  }
  // テレビ: 選んだチャンネルの番組をAIが放送(cont=trueで同じ番組の続き)
  async function tvWatch(channel, cont) {
    setBusy(true);
    addInfo(`📺 チャンネル: ${TV_CHANNELS[channel]}${cont ? "（つづき）" : ""}`);
    const typing = el("div", "chat-info", "…📡 受信中…"); logEl.appendChild(typing); scrollBottom();
    try {
      const data = await callClaudeTv(level, channel, cont ? tvLastProgram : null);
      typing.remove();
      tvChannel = channel; tvLastProgram = data.program_en || "";
      addInfo(`【${data.title_ja || TV_CHANNELS[channel]}】`);
      addNpcLine(data.program_en, data.program_ja || ""); // 英語＋和訳＋🔊(リスニング)
      addTvChannels(); // 続きを見る／チャンネルを変えられる
    } catch (err) {
      typing.remove();
      addInfo("⚠ " + errorMessage(err));
      addTvChannels();
    } finally { setBusy(false); }
  }

  // 料理: 「💡料理のヒント」ボタン(コトハの返事の後に出す)。押すと次の手順＋英語の言い方を助言。
  function addCookHintButton() {
    const box = el("div", "bubble-btns");
    const btn = el("button", "tr-btn hint-btn", "💡 料理のヒント");
    let loading = false;
    btn.addEventListener("click", async () => {
      if (loading || busy || cookDone) return;
      loading = true; btn.textContent = "💡 コトハが考え中…";
      try { const advice = await callCookHint(); addKotohaLine(advice); }
      catch (err) { addInfo("⚠ " + errorMessage(err)); }
      finally { loading = false; btn.textContent = "💡 料理のヒント"; scrollBottom(); }
    });
    box.appendChild(btn);
    logEl.appendChild(box); scrollBottom();
  }

  // 勉強机: 出題(日本語の問題)を表示。💡ヒントボタンつき。
  function addStudyProblem(ja) {
    const box = el("div", "study-q");
    box.appendChild(el("div", "study-q-label", "📝 英訳しよう"));
    box.appendChild(el("div", "study-q-ja", ja));
    const hint = el("div", "study-hint");
    hint.style.display = "none";
    let loaded = false, loading = false;
    const btn = el("button", "tr-btn hint-btn", "💡 ヒントを見る");
    btn.addEventListener("click", async () => {
      if (loading) return;
      if (loaded) { // 2回目以降は表示/非表示の切替
        const show = hint.style.display === "none";
        hint.style.display = show ? "block" : "none";
        btn.textContent = show ? "🔼 ヒントをかくす" : "💡 ヒントを見る";
        return;
      }
      loading = true; btn.textContent = "💡 コトハが考え中…";
      try {
        hint.textContent = await callStudyHint(ja, level);
        hint.style.display = "block";
        loaded = true; btn.textContent = "🔼 ヒントをかくす";
      } catch (err) {
        hint.textContent = "⚠ " + errorMessage(err);
        hint.style.display = "block";
        btn.textContent = "💡 もう一度ヒント";
      } finally { loading = false; scrollBottom(); }
    });
    const btns = el("div", "bubble-btns");
    btns.appendChild(btn);
    box.appendChild(btns);
    box.appendChild(hint);
    logEl.appendChild(box); scrollBottom();
  }
  // 勉強机: 直前の英訳への講評＋模範英訳を表示
  function addStudyFeedback(data) {
    const ok = !!data.correct;
    const box = el("div", "correction " + (ok ? "ok" : "fix"));
    box.appendChild(el("div", "corr-title", ok ? "✓ せいかい！" : "✏️ コトハの添削"));
    if (data.feedback_ja) box.appendChild(el("div", "corr-note", data.feedback_ja));
    if (data.model_en) {
      const line = el("div", "corr-fixed");
      line.appendChild(el("span", "corr-label", "模範: "));
      line.appendChild(el("span", "corr-eng", data.model_en));
      box.appendChild(line);
      if (window.Voice) { const b = el("div", "bubble-btns"); Voice.attachSpeakButton(b, data.model_en, "en"); box.appendChild(b); }
    }
    logEl.appendChild(box); scrollBottom();
    if (window.Voice && data.model_en) Voice.autoSpeak(data.model_en, "en");
  }

  function setBusy(b) {
    busy = b;
    inputEl.disabled = b;
    sendBtn.disabled = b;
    sendBtn.textContent = b ? "..." : sendLabel;
  }

  // ---- APIキー入力パネル ----
  function showKeyPanel() {
    keyInput.value = getApiKey();
    keyPanel.style.display = "block";
    logEl.style.display = "none";
    inputBar.style.display = "none";
    keyInput.focus();
  }
  function hideKeyPanel() {
    keyPanel.style.display = "none";
    logEl.style.display = "flex";
    inputBar.style.display = "flex";
  }
  keySave.addEventListener("click", () => {
    const k = keyInput.value.trim();
    if (!k) { keyInput.focus(); return; }
    setApiKey(k);
    if (window.refreshKeyBar) window.refreshKeyBar();
    hideKeyPanel();
    if (pendingStart) { pendingStart = false; startGreeting(); }
    inputEl.focus();
  });
  keyCancel.addEventListener("click", () => {
    hideKeyPanel();
    if (pendingStart) { pendingStart = false; addInfo("APIキーを入力すると会話できます（⚙ から設定）。"); }
  });
  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); keySave.click(); }
    e.stopPropagation();
  });
  keyBtn.addEventListener("click", showKeyPanel);

  // ---- 「コトハにきく」⇄「会話にもどる」(NPC会話を保持したまま切替) ----
  function updateHelpBtn() {
    if (!helpBtn) return;
    if (suspended) {
      // コトハのサブ会話中: 「とじる」を隠し、「もどる」でNPC会話へ戻す
      helpBtn.style.display = ""; helpBtn.textContent = "← もどる";
      if (closeBtn) closeBtn.style.display = "none";
    } else {
      if (closeBtn) closeBtn.style.display = "";
      if (convMode === "npc") { helpBtn.style.display = ""; helpBtn.textContent = "🧚 コトハ"; }
      else { helpBtn.style.display = "none"; }
    }
  }
  function suspendAndOpenKotoha() {
    // 今のNPC会話のログDOMを退避(添削や和訳ボタンごと保持)
    const frag = document.createDocumentFragment();
    while (logEl.firstChild) frag.appendChild(logEl.firstChild);
    suspended = { convMode, npc, history, frag, placeholder: inputEl.placeholder, sendLabel, name: nameEl.textContent, questHook };
    questHook = null;
    // コトハのサブ会話を開始
    convMode = "kotoha"; npc = { id: "kotoha", name: "コトハ" }; history = [];
    kotohaContext = (window.getKotohaContext && window.getKotohaContext()) || null;
    sendLabel = "きく";
    inputEl.placeholder = "コトハにきく…（日本語でOK）";
    nameEl.textContent = "コトハ"; inputEl.value = "";
    startGreeting();
    updateHelpBtn();
    inputEl.focus();
  }
  function resumeSuspended() {
    const s = suspended; suspended = null;
    convMode = s.convMode; npc = s.npc; history = s.history; sendLabel = s.sendLabel;
    questHook = s.questHook; kotohaContext = null;
    inputEl.placeholder = s.placeholder; nameEl.textContent = s.name;
    logEl.innerHTML = ""; logEl.appendChild(s.frag);
    updateHelpBtn(); scrollBottom();
    inputEl.value = ""; inputEl.focus();
  }
  if (helpBtn) helpBtn.addEventListener("click", () => {
    if (busy) return;
    if (suspended) resumeSuspended();
    else if (convMode === "npc") suspendAndOpenKotoha();
  });

  // ---- エラーを分かりやすい文言に ----
  function errorMessage(err) {
    const code = err && err.code;
    if (code === "no_key") { showKeyPanel(); return "APIキーが未設定です。⚙ から入力してください。"; }
    if (code === "no_proxy") return "プロキシURLが未設定です（本公開用のmode=proxy）。";
    if (code === "http_401") { showKeyPanel(); return "APIキーが無効です。⚙ から入力し直してください。"; }
    if (code === "http_429") return "混雑しています。少し待ってからもう一度送ってください。";
    if (code === "http_400") return "リクエストエラーが起きました（履歴をリセットするには ×とじる → もう一度話しかけてください）。";
    if (typeof code === "string" && code.startsWith("http_")) return "サーバーエラー（" + err.status + "）。少し待って再送してください。";
    if (code === "no_text") return "応答の解析に失敗しました。もう一度送ってください。";
    return "通信に失敗しました。ネット接続を確認してもう一度お試しください。";
  }

  async function turn(isOpening) {
    setBusy(true);
    const typing = el("div", "chat-info", `${npc.name.split(" ").pop()} は考えている…`);
    logEl.appendChild(typing); scrollBottom();
    try {
      if (convMode === "kotoha") {
        const reply = await callKotoha(level, kotohaContext, history);
        typing.remove();
        if (!reply || reply.trim() === "") throw { code: "no_text" };
        addKotohaLine(reply);
        history.push({ role: "assistant", content: reply });
      } else if (convMode === "study") {
        const data = await callClaudeStudy(level, history, studyTheme);
        typing.remove();
        if (!data || typeof data.next_ja !== "string" || data.next_ja.trim() === "") throw { code: "no_text" };
        if (isOpening) { if (data.feedback_ja) addKotohaLine(data.feedback_ja); }
        else {
          addStudyFeedback(data); // 直前の英訳への講評＋模範
          // 正解したら経験値を獲得(難易度に応じて)
          if (data.correct && window.studyCorrectReward) {
            const r = window.studyCorrectReward();
            if (r) {
              addInfo(`✨ コトハの経験値 +${r.exp}（コトハ Lv${r.kotohaLevel}）`);
              (r.leveled || []).forEach((line) => addInfo(line));
            }
          }
        }
        addStudyProblem(data.next_ja); // 次の問題
        history.push({ role: "assistant", content: JSON.stringify({ model_en: data.model_en, next_ja: data.next_ja }) });
      } else if (convMode === "cook") {
        const data = await callClaudeCook(level, history, cookIngredients, cookVariant);
        typing.remove();
        if (!data || typeof data.reply_ja !== "string") throw { code: "no_text" };
        if (!isOpening) addCorrection(data.correction); // 英語の添削
        addKotohaLine(data.reply_ja);
        history.push({ role: "assistant", content: JSON.stringify({ reply_ja: data.reply_ja, done: data.done }) });
        if (data.done && !cookDone) {
          // 完成処理(食材の消費)をゲーム側で確定。材料が無ければ ok:false で完成させない
          const r = cookOnResult ? cookOnResult(data.dish_name_ja, data.score, data.ingredients_used || []) : { ok: true, lines: [] };
          if (r && r.ok === false) {
            if (r.lines) r.lines.forEach((ln) => addInfo(ln)); // 材料不足→続けて指示できる
          } else {
            cookDone = true;
            const noun = cookVariant === "summon" ? "貢物" : "料理";
            addInfo(`🍽 ${data.dish_name_ja || noun} が完成！ 出来栄え ${data.score}点`);
            if (data.comment_ja) addKotohaLine(data.comment_ja);
            if (r && r.lines) r.lines.forEach((ln) => addInfo(ln));
            addInfo(cookVariant === "summon" ? "（× でとじる。貢物は召喚魔法陣で使えるよ）" : "（× でとじる。料理は「もちもの」からタップで食べられるよ）");
          }
        } else {
          addCookHintButton(); // コトハの返事の後に「💡料理のヒント」を出す(次の手順＋英語の言い方)
        }
      } else if (convMode === "cast") {
        const data = await callClaudeCast(level, history, castTribute);
        typing.remove();
        if (!data || typeof data.reply_ja !== "string") throw { code: "no_text" };
        if (!isOpening) addCorrection(data.correction); // 英語の添削
        addKotohaLine(data.reply_ja);
        history.push({ role: "assistant", content: JSON.stringify({ reply_ja: data.reply_ja, done: data.done }) });
        if (data.done && !castDone) {
          castDone = true;
          if (castOnResult) {
            const r = castOnResult(data.beast_name_ja, data.element, data.incantation_quality);
            if (r && r.lines) r.lines.forEach((ln) => addInfo(ln));
          }
          addInfo("（× でとじる。召喚獣カードは戦闘中に「しょうかん」で使えるよ）");
        }
      } else {
        // 直前のプレイヤー発言(好感度判定などに使う)
        const last = history[history.length - 1];
        const userText = (last && last.role === "user") ? last.content : "";
        const data = await callClaude(npc, level, history);
        typing.remove();
        if (!data || typeof data.reply !== "string" || data.reply.trim() === "") throw { code: "no_text" };
        if (!isOpening) addCorrection(data.correction);
        addNpcLine(data.reply, data.reply_ja || "");
        history.push({ role: "assistant", content: data.reply });
        // 毎ターンのフック(開始の挨拶ターンは除く)
        if (!isOpening && questHook && questHook.onReply) questHook.onReply(data, userText);
        // 全NPC共通の好感度(英語の質で上昇・口調が親しくなる)。文脈外/単調は無効点。
        if (!isOpening && window.npcAffectionReply) {
          const r = window.npcAffectionReply(npc.id, npc.name, data, userText);
          if (r && r.lines) r.lines.forEach((ln) => addInfo(ln));
        }
        // クエストフラグ判定(会話の中で条件を満たしたら発火。persist指定のフックは消さない)
        if (questHook && data.quest_flag === true && !questHook.persist) {
          const h = questHook; questHook = null;
          if (h.flagMessage) addInfo(h.flagMessage);
          if (h.onFlag) h.onFlag();              // 即時(会話は続ける)
          if (h.onClose) pendingClose = h.onClose; // 会話を閉じたら実行
          if (h.autoClose) setTimeout(() => { if (opened) close(); }, 1200); // フラグ後に自動でとじる
        }
      }
    } catch (err) {
      typing.remove();
      addInfo("⚠ " + errorMessage(err));
      // 失敗したユーザー発言は履歴から戻す（再送できるように。履歴を汚さない）
      if (!isOpening && history.length && history[history.length - 1].role === "user") history.pop();
    } finally {
      setBusy(false);
      if (opened && keyPanel.style.display === "none") inputEl.focus();
    }
  }

  function startGreeting() {
    if (convMode === "kotoha") {
      addKotohaLine("どうしたの、相棒？ 英語で何て言えばいいか、町の人の言葉の意味、冒険で困ったこと…なんでも聞いて！");
      return;
    }
    if (convMode === "study") {
      // まずテーマを選んでもらう(選択後にドリル開始)
      addThemePicker();
      return;
    }
    if (convMode === "cook") {
      if (cookVariant === "summon") {
        addInfo("🔮 コトハ「召喚料理を作ろう！ モンスターの素材を使って、英語で手順を教えてね。」");
        addInfo(cookIngredients.length ? (`🧺 手持ちの素材（${cookIngredients.length}種）: ` + cookIngredients.join("、")) : "（素材がないみたい。モンスターをたおして素材を集めよう！）");
      } else {
        addInfo("🍳 コトハ「料理しよう！ 英語で手順を教えてね。できあがったら『I'm done』って言ってね。」");
        addInfo(cookIngredients.length ? (`🧺 手持ちの食材（${cookIngredients.length}種）: ` + cookIngredients.join("、")) : "（食材がないみたい。食料品店で買ってこよう！）");
      }
      history.push({ role: "user", content: "(料理を始めるよ。何を作るか提案して。)" });
      turn(true);
      return;
    }
    if (convMode === "tv") {
      addInfo("📺 テレビをつけた。見たいチャンネルを選んでね（テレビだから話しかけても反応しないよ）。");
      addTvChannels();
      return;
    }
    if (convMode === "cast") {
      addInfo("🔮 コトハ「召喚魔法陣に貢物『" + (castTribute || "料理") + "』を捧げたよ。英語で召喚の詠唱を唱えて！」");
      addInfo("（かんたんでOK！ 例: \"Come, dragon!\" \"I summon you!\" 上手な英語ほど良い召喚獣が出やすいよ）");
      history.push({ role: "user", content: "(儀式を始めるよ。詠唱をうながして。)" });
      turn(true);
      return;
    }
    if (questHook && questHook.intro) String(questHook.intro).split("\n").forEach((ln) => addInfo(ln)); // ミッション説明(改行対応)
    addInfo("コトハ「英語で話しかけてみて！ 変なところは私が直すから！」");
    // 定型あいさつがあるNPC(例: ライラ)は、最初の一言だけAIを呼ばず定型文からランダムに出す(トークン節約)
    const greetings = (!questHook || !questHook.note) ? NPC_GREETINGS[npc.id] : null; // クエスト連動の会話中は通常どおりAI
    if (greetings && greetings.length) {
      const g = greetings[Math.floor(Math.random() * greetings.length)];
      addNpcLine(g.en, g.ja);
      history.push({ role: "assistant", content: g.en }); // 2ターン目以降の文脈として履歴に残す
      return;
    }
    history.push({ role: "user", content: "(The traveler walks up and greets you.)" });
    turn(true);
  }

  function sendUser() {
    if (busy) return;
    if (AI_CONFIG.mode === "browser" && !getApiKey()) { showKeyPanel(); return; }
    if (convMode === "study" && !studyTheme) { addInfo("コトハ「まずは上のボタンから今日のテーマを選んでね！」"); return; }
    if (convMode === "cook" && cookDone) { addInfo("コトハ「もう完成したよ！ × でとじてね。」"); return; }
    if (convMode === "cast" && castDone) { addInfo("コトハ「もう召喚できたよ！ × でとじてね。」"); return; }
    if (convMode === "tv") { addInfo("📺 テレビは見るだけ！ 下のチャンネルボタンで切り替えてね。"); return; }
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    addPlayerLine(text);
    history.push({ role: "user", content: text });
    turn(false);
  }

  sendBtn.addEventListener("click", sendUser);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); sendUser(); }
    e.stopPropagation();
  });
  closeBtn.addEventListener("click", close);

  function open(npcObj, toeicLevel, onClose) {
    convMode = "npc"; kotohaContext = null; sendLabel = "話す";
    npc = npcObj; level = toeicLevel; onCloseCb = onClose || null;
    // 面識判定 → 今回の会話で「会ったことがある」状態にする
    travelerKnown = !!(window.npcKnowsName && window.npcKnowsName(npcObj.id));
    if (window.markNPCMet) window.markNPCMet(npcObj.id);
    if (window.affectionOpen) window.affectionOpen(npcObj.id); // 好感度: 会話ごとの単調判定をリセット
    inputEl.placeholder = "英語で話す… (Enterで送信)";
    beginSession(npcObj.name);
  }

  // コトハに相談(日本語で答えてくれる)
  function openKotoha(toeicLevel, context, onClose) {
    convMode = "kotoha"; kotohaContext = context || null; sendLabel = "きく";
    npc = { id: "kotoha", name: "コトハ" }; level = toeicLevel; onCloseCb = onClose || null;
    inputEl.placeholder = "コトハにきく…（日本語でOK・Enterで送信）";
    beginSession("コトハ");
  }

  // 勉強机: コトハと和文英訳のドリル
  function openStudy(toeicLevel, onClose) {
    convMode = "study"; kotohaContext = null; sendLabel = "答える"; studyTheme = null;
    npc = { id: "kotoha", name: "コトハ" }; level = toeicLevel; onCloseCb = onClose || null;
    inputEl.placeholder = "英語で答える… (Enterで送信)";
    beginSession("コトハ（英訳れんしゅう）");
  }

  // 台所: コトハと料理。ingredients=使える手持ち食材, onResult(name,score,used)=完成時
  function openCooking(toeicLevel, ingredients, onResult) {
    convMode = "cook"; cookVariant = "normal"; kotohaContext = null; sendLabel = "指示する";
    cookIngredients = ingredients || []; cookOnResult = onResult || null; cookDone = false;
    npc = { id: "kotoha", name: "コトハ" }; level = toeicLevel; onCloseCb = null;
    inputEl.placeholder = "英語で手順を指示… (Enterで送信)";
    beginSession("コトハ（料理）");
  }
  // 召喚料理: モンスター素材で貢物を作る
  function openSummonCook(toeicLevel, materials, onResult) {
    convMode = "cook"; cookVariant = "summon"; kotohaContext = null; sendLabel = "指示する";
    cookIngredients = materials || []; cookOnResult = onResult || null; cookDone = false;
    npc = { id: "kotoha", name: "コトハ" }; level = toeicLevel; onCloseCb = null;
    inputEl.placeholder = "英語で手順を指示… (Enterで送信)";
    beginSession("コトハ（召喚料理）");
  }
  // 召喚魔法陣: 貢物を捧げて英語詠唱→召喚獣カード
  function openSummonCast(toeicLevel, tributeName, onResult) {
    convMode = "cast"; kotohaContext = null; sendLabel = "となえる";
    castTribute = tributeName || ""; castOnResult = onResult || null; castDone = false;
    npc = { id: "kotoha", name: "コトハ" }; level = toeicLevel; onCloseCb = null;
    inputEl.placeholder = "英語で詠唱をとなえる… (Enterで送信)";
    beginSession("召喚魔法陣");
  }
  // テレビ: AI放送(チャンネル選択のみ・一方通行)
  function openTV(toeicLevel) {
    convMode = "tv"; kotohaContext = null; sendLabel = "－"; tvChannel = ""; tvLastProgram = "";
    npc = { id: "tv", name: "テレビ" }; level = toeicLevel; onCloseCb = null;
    inputEl.placeholder = "テレビは見るだけ（チャンネルを選んでね）";
    beginSession("テレビ");
  }

  function beginSession(title) {
    suspended = null;
    pendingClose = null;
    history = [];
    logEl.innerHTML = "";
    nameEl.textContent = title;
    overlay.style.display = "flex";
    opened = true;
    inputEl.value = "";
    hideKeyPanel();
    updateHelpBtn();
    if (AI_CONFIG.mode === "browser" && !getApiKey()) {
      pendingStart = true;
      showKeyPanel();
    } else {
      startGreeting();
    }
  }

  function close() {
    overlay.style.display = "none";
    opened = false;
    pendingStart = false;
    if (window.Voice) Voice.cancel(); // 読み上げ中なら止める
    questHook = null;
    suspended = null;
    const after = pendingClose; pendingClose = null;
    const cb = onCloseCb; onCloseCb = null;
    if (cb) cb();
    if (after) after(); // 「売りたい/泊まりたい」など、閉じた後の動作
  }

  return { open, openKotoha, openStudy, openCooking, openSummonCook, openSummonCast, openTV, close, isOpen: () => opened, aiReady, setQuest: (h) => { questHook = h; }, info: (t) => addInfo(t) };
})();

window.Chat = Chat;

// =====================================================================
// 画面上部のAPIキー入力バー（常時表示・localStorageに即保存）
// =====================================================================
(function initKeyBar() {
  const field = document.getElementById("apikey-field");
  const status = document.getElementById("apikey-status");
  const clearBtn = document.getElementById("apikey-clear");
  if (!field || !status) return;

  function refresh() {
    const has = getApiKey().trim().length > 0;
    if (has) {
      status.textContent = "🔑 マイキー使用中 — 自分のAnthropic APIキーでNPCとAI英会話できます。";
      status.className = "key-on";
    } else {
      status.textContent = "未設定 — 自分のAnthropic APIキーを入れるとNPCと英会話できます（キーはこの端末にのみ保存）。";
      status.className = "key-off";
    }
  }

  // 開発用: モデル切替ボタン
  const modelBtn = document.getElementById("dev-model");
  if (modelBtn) { modelBtn.addEventListener("click", toggleModel); renderModelBtn(); }

  field.value = getApiKey();
  field.addEventListener("input", () => { setApiKey(field.value.trim()); refresh(); });
  field.addEventListener("keydown", (e) => e.stopPropagation()); // ゲーム操作にキーを奪われない
  clearBtn.addEventListener("click", () => {
    field.value = "";
    setApiKey("");
    refresh();
    field.focus();
  });

  // チャット内パネルなど他所から保存されたとき同期できるよう公開
  window.refreshKeyBar = () => { field.value = getApiKey(); refresh(); };
  refresh();
})();
