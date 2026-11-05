# Browser rough mixes and stem alignment review

Contributors can submit one to three stems without uploading a separate listening mix in any instrument/foundation round. Existing listening mixes and legacy grouped takes remain usable. Owner previews combine each candidate with the approved project recordings separately, excluding its other submitted alternatives. Royalty and selection rules are unchanged. Original uploaded files and original-download links are retained.

## Rough recording downloads

The shared layered player now offers a merged stereo 16-bit WAV at 44.1 kHz. Include/mute, Solo and volume settings determine the exported sources and relative levels. The exporter decodes and sums one source at a time, preserving leading silence, a common zero point and the full selected-file length. Overlapping approved ranges are merged before summing; unapproved sections remain silent and are never shifted earlier. Mono is centred in stereo; stereo channels are retained. Overall level is only reduced if necessary to leave headroom and prevent clipping; quiet material is not boosted. No rendered mix is uploaded to Cloudinary or substituted for an original stem.

Browser exports/previews support mono/stereo recordings up to ten minutes. Unsupported codecs, failed downloads and decode errors are shown with a retry/re-export instruction; no partial mix is offered as success. Export cancellation and component/account changes abort fetching and release object URLs. WAV is used because browser decoding support does not supply a portable MP3 encoder. Large files still require browser memory and may need a desktop browser or local recording software.

The implementation uses current Web Audio [decodeAudioData documentation](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData) and the [OfflineAudioContext API](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext), checked on 5 November 2026. Decoding resamples to the common context rate; summing and WAV encoding happen locally.

## Per-file preview and confirmation

Each newly uploaded `take_stem` is marked `alignmentReviewRequired=true`. Upload opens a lightbox which creates a single, aligned listening preview of that file with current approved stems/sections and click references. Before any approved recording exists, it uses the latest available audio guide (or demo fallback); a first foundation stem can be checked alone. Other project playback pauses so it cannot be heard over the preview. The checkbox requires actual playback, followed by the contributor's confirmation that the start point and timing fit. This is an attestation, not automatic musical timing detection or correction. Closing the dialog keeps the private file and leaves it unconfirmed; Submit a take reopens missing checks.

`POST /assets/:assetId/alignment-review` accepts only the file owner, a positive declaration and a current server-generated recording-context hash. The asset stores that hash, the authenticated reviewer ID and server timestamp. Submission validates required receipts both before and inside its transaction. Changed approved sources/ranges invalidate an earlier receipt; the contributor is asked to replay the updated preview. Replacement submissions validate their new files too. Legacy uploads without the required marker remain compatible and can be checked voluntarily; there is no retrospective signing or data backfill.

Contributor terms version 0.6 describe optional mixes and the new review step. Previous accepted text/hash records stay intact; mix/master agreement versions and royalty clauses are unchanged. Round-open emails now describe the same stems-only workflow.

## Access and deployment

Preview, confirmation and `/assets/:assetId/audio` use the existing authenticated project-participation gate. The audio route shares the original asset visibility policy, accepts audio only and streams a signed Cloudinary source without exposing the upstream URL. It avoids relying on cross-origin access to Cloudinary private-download responses. Responses are private/no-store; source transfers are bounded by the existing 100 MB upload limit, with timeout and disconnect cancellation. Hidden, unrelated and other contributors' unsubmitted files remain unavailable. Do not remove these gates to make browser decoding work.

Deploy the backend before the admin, or deploy them together. No new unique index or production backfill is needed. Contributor receipts use new asset fields. New frontend audio/export routes require the backend version; verify a real private Cloudinary WAV and an MP3 after deployment. Local validation uses synthetic 48 kHz/44.1 kHz audio, model fixtures and mocked Cloudinary delivery, with no live upload, email or data changes.

Validation covers source inclusion/solo/volume, stereo WAV samples and silence, resampling and partial ranges, independent take previews, unconfirmed submission rejection, changed-context rejection, contributor ownership, protected byte streaming, legacy uploads, upload-to-popup-to-submission, and desktop/mobile layout. Fixtures exercise actual controllers and actual browser audio decoding/rendering.
