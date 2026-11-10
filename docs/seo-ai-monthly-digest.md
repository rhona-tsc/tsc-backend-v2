# Combined monthly SEO and AI visibility digest

The existing monthly job and recipient list now produce one SEO and AI visibility email. No second scheduler or mailing list is introduced. Organic figures cover the previous completed calendar month. AI results are a dated point-in-time sample collected when the report runs, not retrospective monthly traffic or a universal rank.

## Sources and baseline

- Google Search Console remains the source for keyword impressions, clicks, CTR and impression-weighted average position. Web totals can include Google's AI features; the current query does not isolate AI Overview traffic. Ads keyword imports are watchlist sources only, not Ads cost or conversion measurements.
- ChatGPT search and Google AI Overviews use SearchApi's documented search engines. These are sampled consumer search answers, not generic OpenAI API answers relabelled as ChatGPT. Provider documentation: https://www.searchapi.io/docs/chatgpt-api and https://www.searchapi.io/docs/google-ai-overview-api .
- The UK English default watchlist has nine county questions plus funk/soul and UK garage questions. Prompts contain no agency or artist name, avoiding a branded prompt that manufactures mentions. Brand mentions and citations to the agency's exact apex/www hosts are separate measures. Selected artist-name matches (Magnolia Sky, Gotta Be Garage, The Riot Dogs, Funk Royale, Indigo Delight) are evidence of names appearing, not a claim of recommendation.
- Missing overviews, unavailable requests, incomplete answers and unresolved citations are explicit states. Organic Google links and ChatGPT retrieved-but-uncited results are never counted as AI citations. The first successful sample establishes the baseline. Changes to the question set, model or observed coverage disable misleading like-for-like deltas.
- Google documentation: https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports and https://developers.google.com/webmaster-tools/v1/searchanalytics/query . Dedicated Google AI reports exist, but no unsupported API type or guessed searchAppearance filter has been added here.

## Connection required before AI collection

Set `SEARCHAPI_API_KEY` securely on the backend hosting service after the owner chooses and funds a provider account. Never add this key to frontend variables, source control or URLs. Existing `OPENAI_API_KEY` is not used, and no new subscription or paid requests were started by implementation or tests.

The tracker defaults to including AI once connected, and provides an explicit switch and editable question list. The existing day and recipients are preserved. Refreshing or manually emailing a report reads the cached sample; it does not purchase checks or start a long browser request. The scheduled run collects a first sample only if connected. For the 11 default questions, the bound is 22 initial requests and at most 11 Google overview follow-ups, without automatic paid retries. Provider credit multipliers and plan minimums must be checked before purchasing; request counts are not a currency budget.

Monthly AI observations are unique by property, report month and watchlist hash. A failed sample is retained rather than silently retried. A report lease prevents overlapping automatic jobs sending duplicate digests. The monthly emailedAt check continues to suppress repeat scheduled sends. Explicit staff sends remain possible. No AI failure blocks the organic report.

Google can return encrypted citation links. The live trial confirmed this, so the integration resolves up to 25 destinations in one bounded POST batch per overview, without retries. SearchApi documents this resolver as using zero search credits: https://www.searchapi.io/docs/google-resolve-api . Failed or still-pending links remain unknown and are omitted from citation absence claims. Evidence stores at most a short 500-character excerpt and 30 safe citations per answer, with no raw provider payload, API URL or credentials. Email displays up to five links per answer; admin stores the remaining source evidence.

## Validation and operational notes

Tests use synthetic provider responses and mocked models; no paid checks, real email, booking, application or payment is submitted. Test cases cover citation versus retrieval, exact domain matching, missing/truncated data, Google token follow-up, cache reuse, comparisons, HTML escaping, year boundaries and report concurrency.

The tracker previously contained 24 keywords and sent its October report on 4 November 2026. That stored report had one impression for "funk wedding band" at average position 64 and zero recorded impressions for the other 23 phrases. This is too sparse to support a growth claim. The reviewed watchlist script adds nine county phrases, the historically supplied "essex wedding band", and five artist names without replacing existing terms or changing recipients or schedule. These manual terms do not imply known search volume.

A fresh page-level Search Console query could not be authenticated from the local environment, so no fresh page-level metrics have been inferred. The existing stored monthly snapshot remains the current organic baseline. Production credentials are not copied out of hosting to work around that limitation.

## Release and rollback

Deploy the backend before the updated admin. Netlify builds the public and admin sites from main; the backend requires a manual Render deployment. Keep unrelated working-tree changes out of the release. No destructive database migration is involved. If needed, restore the previous hosting deployment; new optional fields and the AI observation collection can remain without affecting older code.

The description script is separately authorised public content maintenance: it fills only blank short descriptions for the two named acts, compares the original biography to avoid concurrent changes, and preserves all existing descriptions. The watchlist script compares the original keyword array before appending entries. Both default to previews and require `--apply` for writes.
