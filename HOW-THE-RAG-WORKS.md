# How the RAG works (explained like you're 5)

## The story

Imagine our restaurant wants to send party invitations, say for a **Seafood Festival**.

We want to invite the right people:

- people who **love** seafood 🐟
- people who would **enjoy** the party
- and **never** anyone who gets sick from seafood 🚫

The RAG is a helper robot that picks those people for us. Here's how it thinks, step by step.

---

## Step 0: The receipts 🧾

Every time a family eats at the restaurant, we keep a receipt (`data/mock/invoices.csv`).
It says who came, how many people, what time, what they ate, how much they paid, and what
they're allergic to.

The robot first **checks every receipt is honest**: every dish is on the menu, every price
matches the menu book, and the totals add up to the cent. If a receipt is wrong, the robot
stops and says which one.

## Step 1: One card per guest 🪪

Reading 35 receipts every time would be slow, so the robot makes **one card per guest**:

> **Sarah's card:** came 2 times · always eats seafood (100%) · small tables of 2 to 4 ·
> likes wine · came once at happy hour · spends about $128 a visit · allergies: none

The card has two sides:

- **A story side**, in words: *"Main courses ordered: 100% seafood. Favourite dishes:
  Grilled Prawn Salad x3, Barramundi x2..."*
- **A numbers side**: seafood = 1000 out of 1000, party size = 4, allergic to seafood = no...

The story side **never** has the guest's name, phone number, or allergies in it (more on
why later).

## Step 2: The magic library 📚 (ChromaDB)

The robot puts all the cards into a **magic library** called **Chroma**.

The magic: the library shelves cards by **what they mean**, not alphabetically. A small
brain (the *embedding model*) reads each story and gives it a spot on a giant map.
Stories about the same thing end up **close together**:

```
        🐟 seafood corner                        🥩 steak corner
     Sarah ●  ● Lucas                        ● James   ● Daniel
          ● Aisha                               ● Emma

                       🍷 wine & dinner corner
                          ● Tom   ● Carlos
```

When we ask *"who loves seafood?"*, the robot puts our question on the same map and looks
at who's standing **nearby**. That's the "R" in RAG: **Retrieval**, finding the right cards.

> Everything here runs on your laptop. No internet and no cost.

## Step 3: The bouncer 🚪 (hard rules)

Being *near* the question isn't enough. Each party has a **bouncer with a list of rules**:

- "Must spend $100 or more per visit"
- **"Must NOT be allergic to seafood"** ← the most important rule

The bouncer works **inside the library**, so allergic guests are never even handed to
the robot. For the Seafood Festival, 6 of our best customers (Olivia, Hannah, Mei Lin,
Daniel, Emma, Marco) are allergic to seafood, so they are **left out**. The robot also tells
us they were left out and why.

## Step 4: The teacher double-checks ✅

Libraries can make mistakes. (Ours did once! It treated "0" as if it were "0.5", so it
let in people who don't like seafood at all.)

So a **teacher** checks every card the library gave back against the **original
receipts**, not the library's copy:

1. Does this guest really pass every rule?
2. Is anyone allergic to the food we're promoting? → **If yes: STOP everything.**
   The robot refuses rather than quietly fixing it, so we always find out.
3. Is anyone missing? If the library has an old copy of the cards, it says *"please
   run `npm run ingest` to refresh the library"*.

This is why an allergic guest **can never** get an invitation. Three separate checks
must all fail first: the bouncer, the teacher, and the final stop sign.

## Step 5: Lining up 🏃 (ranking)

Now we have everyone who's allowed to come. Who goes **first** in line?

We learned the map is great at **topics** ("this is about seafood") but bad at
**how much** ("a party of 50" and "a party of 32" look almost the same to it). So each
guest gets **two stars**:

- ⭐ **Closeness star:** how near their card is to the question on the map
- ⭐ **Fan star:** how big a fan they really are, from the numbers side of the card
  (for the Seafood Festival: *how much of what they eat is seafood?*)

**Final score = half closeness + half fan.** Highest score goes first.

> Rules like "spends $100+" decide who may come in. They do **not** make you a bigger
> fan, so they don't change your place in line.

For the Seafood Festival the line is: **Sarah (100% seafood) → Lucas → Aisha → ...**

We tested this: before the two stars, the line matched real fans 0.64 out of 1; now it's
0.77 overall, or 0.92 without two known-hard campaigns (`npm run eval:ranking` measures it;
see `rag-tuning-findings.txt`).

## Step 6: The letter writer ✍️ (the "G" in RAG: Generation)

Finally, a letter writer (the AI model **DeepSeek**) writes the invitation email.

We only tell the writer **general things**:

> "Seafood Festival. Dishes: Barramundi ($34.00), Grilled Prawn Salad ($26.00), Fish &
> Chips ($22.00). 9 guests who spend $100+ per visit. Greet them with {{first_name}}."

The writer **never** learns anyone's name, email, phone, or allergies. The real names get
filled in later, at sending time.

- **No DeepSeek key yet?** The robot does a **dry run**: it shows who would be invited and
  the exact note it *would* send to the writer, but writes no letter.
- **Nobody allowed to come?** It doesn't bother the writer at all.

---

## Talking to the robot 💬 (the chat page)

Open **http://localhost:3000** and just type, like texting a friend.

**Ask WHO** (starts with *who / which / show / list*) and the robot lists guests:

> **You:** who is allergic to red meat?
> **Robot:** 5 guests: Priya, Raj, Hannah, Olivia, Aisha (with what they spend and what they're allergic to)

**Ask for a CAMPAIGN** (says *campaign / promo / deal / offer*) and the robot **designs the party for you**:

> **You:** create a marketing campaign for non seafood fans
> **Robot:** ★ **Happy Hour Meat Lovers Bundle for 5:** 5x Beef Steak + 3x Fries + 5x House Wine
> for **$190** (menu $271, save $81). Happy hour, dine-in.
> *Why:* 9 of 11 diners mostly eat red meat · typical table is 5 · half come at happy hour ·
> they like wine. ⚠ Left out: Hannah and Olivia (allergic to red meat). Invite these 12 guests...

How does the robot design the party? Like a good party planner:

1. **Who's coming?** It reads your words (*"non seafood fans"* → "eats seafood less than 25% of
   the time") and shows you **exactly how it understood you**, so you can check.
2. **What do they love?** Every guest gets **one vote** for the food they eat most (so one big
   50-person table can't shout over everyone). Most votes wins. If it's a tie, it picks the food
   that **leaves out fewer allergic guests**.
3. **How many per table?** The usual table size for these guests.
4. **When?** If at least half of them come at happy hour, it's a happy hour deal.
5. **How much?** Real menu prices, **minus 30%**, rounded to a nice $5. Never made up.
6. **Safety:** the bouncer and teacher from before still check that nobody gets food they're
   allergic to.

Words the robot understands:

| Say... | It means... |
|---|---|
| *seafood / red meat / chicken / veggie **fans** (or lovers)* | eats that food at least half the time |
| ***non** seafood fans*, *don't like chicken* | eats that food less than 25% of the time |
| *allergic to red meat* / ***not** allergic to seafood* | has / doesn't have that allergy |
| *just to chill*, *only sides*, *no mains* | comes for drinks and sides only, at least half the time |
| *snacks* | spends at least half their money on sides and drinks |
| *happy hour* | comes 16:00-18:00 at least half the time |
| *wine lovers* | 0.75+ glasses of wine per guest |
| *spends more than $500 (per visit)* / *spent over $500 **in total*** | big bill per visit / big total |
| *under $100*, *budget* | spends under that per visit |
| *big parties*, *event hosts* / *small parties*, *couples* | biggest party 26+ / 4 or fewer |
| *VIP*, *Q1-Q4*, *regulars* | booked a VIP room / visited that quarter / 2+ visits |
| *tell me about Priya Nair*, *elaborate raj* | everything about that one guest: contact, allergies, habits and every invoice |

The robot doesn't need the internet or a paid AI for any of this. With a DeepSeek key, it also
writes the invitation email.

---

## The whole thing in one picture

```
 🧾 receipts ──check──▶ 🪪 one card per guest ──▶ 📚 magic library (Chroma)
                                                        │
 ❓ "Seafood Festival for big spenders" ────────────────┤
                                                        ▼
                         🚪 bouncer: rules + "no seafood allergy"   (inside library)
                                                        ▼
                         ✅ teacher: re-check with receipts; STOP if anyone allergic
                                                        ▼
                         🏃 line up: ½ closeness ⭐ + ½ fan ⭐
                                                        ▼
                         ✍️ letter writer (no names, no allergies) → invitation draft
                                                        ▼
 📬 answer: who to invite (in order), who was left out and why, the draft letter,
            and a "trace" of every step and how long it took
```

## Why the cards never mention allergies

If Daniel's card said *"seafood allergy"*, the map would put him **near the seafood corner**,
because the word "seafood" is right there! He would look like a seafood fan. So allergies
live **only** on the numbers side, where the bouncer and teacher use them as a hard **no**.
Words are for *liking*; numbers are for *rules*.

---

## Try it yourself

```bash
npm run chroma        # 1. open the magic library (keep this running)
npm run ingest        # 2. make the guest cards and put them in the library
npm run dev           # 3. start the robot (the RAG API) at http://localhost:3000
npm run frontend      # 4. optional: a separate chat window at http://localhost:3001
```

The chat at **:3001** is a separate little app that sends your prompt to the robot on :3000
and shows its answer. If the robot isn't running, it tells you so instead of breaking.
(Port 5000 is taken by macOS AirPlay Receiver, so the frontend uses 3001; change it with
`FRONTEND_PORT` in `.env`.)

Then open **http://localhost:3000** in your browser and start chatting (or click one of the example
buttons). Grown-ups who like raw JSON can still use `/api`, `/campaigns` and `POST /campaigns/ask`.

Other useful commands:

| Command | What it does |
|---|---|
| `npm test` | Runs all the checks (start `npm run chroma` first for the library tests) |
| `npm run eval:ranking` | Grades how well the line-up order matches real fans |
| `npm run ingest` | Re-run whenever `invoices.csv` changes |

To get real letters, copy `.env.example` to `.env` and add `DEEPSEEK_API_KEY=...`.

## Grown-up words, translated

| Grown-up word | Kid version | Where in the code |
|---|---|---|
| RAG (Retrieval-Augmented Generation) | Find the right cards, then write the letter | the whole project |
| Guest profile | The guest's card | `src/domain/guest-profile.ts` |
| Embedding | The card's spot on the meaning-map | `src/rag/vector-store.ts` |
| Vector DB (ChromaDB) | The magic library | `npm run chroma` |
| Metadata filter (`where`) | The bouncer's list | `src/campaign/conditions.ts` |
| Verify / safety layers | The teacher + the stop sign | `src/rag/retrieve.ts`, `src/campaign/safety.ts` |
| Hybrid re-rank | Two stars: closeness + fan | `src/rag/rerank.ts` |
| LLM (DeepSeek) | The letter writer | `src/rag/draft.ts` |
| Trace | The robot's diary of each step | `trace` in every API answer |
| Campaign preset | A ready-made party question | `src/campaign/presets.ts` |
| Prompt interpreter | The robot's ears: turns your words into rules | `src/chat/interpret.ts` |
| Campaign planner | The party planner: picks food, size, time, price | `src/chat/planner.ts` |
| Chat page | Where you talk to the robot | `src/chat/page.ts`, http://localhost:3000 |

## Want more detail?

- `memo.txt`: every decision and why
- `rag-sequence-diagram.txt`: the original step-by-step diagram
- `rag-tuning-findings.txt`: what we measured, what was wrong, and how we fixed it
