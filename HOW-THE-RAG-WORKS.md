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

Reading 25 receipts every time would be slow, so the robot makes **one card per guest**:

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
the robot. For the Seafood Festival, 5 of our best customers (Olivia, Hannah, Mei Lin,
Daniel, Emma) are allergic to seafood, so they are **left out**. The robot also tells
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

We tested this: before the two stars, the line was right about 64% of the way; now it's
about 87% (`npm run eval:ranking` measures it).

## Step 6: The letter writer ✍️ (the "G" in RAG: Generation)

Finally, a letter writer (the AI model **DeepSeek**) writes the invitation email.

We only tell the writer **general things**:

> "Seafood Festival. Dishes: Barramundi ($34.00), Grilled Prawn Salad ($26.00), Fish &
> Chips ($22.00). 8 guests who spend $100+ per visit. Greet them with {{first_name}}."

The writer **never** learns anyone's name, email, phone, or allergies. The real names get
filled in later, at sending time.

- **No DeepSeek key yet?** The robot does a **dry run**: it shows who would be invited and
  the exact note it *would* send to the writer, but writes no letter.
- **Nobody allowed to come?** It doesn't bother the writer at all.

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
npm run dev           # 3. start the robot at http://localhost:3000
```

Then open in your browser:

- http://localhost:3000/campaigns: all 12 ready-made questions
- http://localhost:3000/campaigns/seafood-festival-high-spenders: run one

Other useful commands:

| Command | What it does |
|---|---|
| `npm test` | Runs all 82 checks (start `npm run chroma` first for the library tests) |
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

## Want more detail?

- `memo.txt`: every decision and why
- `rag-sequence-diagram.txt`: the original step-by-step diagram
- `rag-tuning-findings.txt`: what we measured, what was wrong, and how we fixed it
