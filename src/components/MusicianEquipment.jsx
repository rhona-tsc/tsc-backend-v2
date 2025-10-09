import React from "react";
import { assets } from "../assets/assets";

const Section = ({ title, children }) => (
  <div className="mb-6">
    <h2 className="text-xl font-semibold border-b-2 border-gray-300 pb-1 mb-3 text-gray-700">
      {title}
    </h2>
    {children}
  </div>
);

const RowList = ({ items }) => (
  <ul className="list-disc pl-5 space-y-1 text-[17px] text-gray-700">
    {items}
  </ul>
);

// ⬇️ No wattage shown
const specLine = (obj = {}) => {
  const bits = [];
  const name = (obj.name || "").toString().trim();
  const quantity = obj.quantity;

  if (name) bits.push(`${name}m`);   // e.g. "10m"
  if (quantity) bits.push(`x ${quantity}`); // e.g. "x5"

  return bits.join(" ");
};

const cableLine = (obj = {}) => {
  const bits = [];
  const length = (obj.length || "").toString().trim();
  const quantity = obj.quantity;
  if (length) bits.push(`${length}m`);
  if (quantity) bits.push(`x ${quantity}`);
  return bits.join(" ");
};

// ⬇️ Helpers to drop rows that are effectively blank (all fields "")
const isMeaningfulRow = (row = {}) => {
  if (!row || typeof row !== "object") return false;
  const name = (row.name ?? "").toString().trim();
  const quantity = (row.quantity ?? "").toString().trim();
  const length = (row.length ?? "").toString().trim();
  // wattage intentionally ignored
  return Boolean(name || length || quantity);
};
const cleanArray = (arr = []) => arr.filter(isMeaningfulRow);

const EquipmentChips = ({ items = [] }) => (
  <div className="flex flex-wrap gap-2">
    {items.map((label) => (
      <span
        key={label}
        className="px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700 border border-gray-300"
      >
        {label}
      </span>
    ))}
  </div>
);

const MusicianEquipment = ({ actData }) => {
  if (!actData) return null;

  // Pull directly from musician model
  const {
    // PA & backline
    paAndBackline = [],
    backline = [],
    instrumentSpecs = [],
    paSpeakerSpecs = [],
    floorMonitorSpecs = [],
    mixingDesk = [],

    // Mics & monitoring
    vocalMics = {},
    instrumentMics = {},
    speechMics = {},
    inEarMonitoring = {},

    // Cables
    cableLogistics = [],
    extensionCableLogistics = [],

    // Lighting
    uplights = [],
    tbars = [],
    lightBars = [],
    discoBall = [],
    otherLighting = [],

    // DJ
    djEquipment = [],
    djGearRequired = [],
    djEquipmentCategories = [],
    additionalEquipment = {},

    // names (optional)
    tscName,
    firstName,
    lastName,
  } = actData || {};

  const performerName =
    [`${firstName || ""}`, `${lastName || ""}`].join(" ").trim() ||
    tscName ||
    "This performer";

  // ⬇️ Filtered arrays (blank rows removed)
  const _instrumentSpecs = cleanArray(instrumentSpecs);
  const _paAndBackline = cleanArray(paAndBackline);
  const _backline = cleanArray(backline);
  const _paSpeakerSpecs = cleanArray(paSpeakerSpecs);
  const _floorMonitorSpecs = cleanArray(floorMonitorSpecs);
  const _mixingDesk = cleanArray(mixingDesk);
  const _cableLogistics = cleanArray(cableLogistics);
  const _extensionCableLogistics = cleanArray(extensionCableLogistics);
  const _uplights = cleanArray(uplights);
  const _tbars = cleanArray(tbars);
  const _lightBars = cleanArray(lightBars);
  const _discoBall = cleanArray(discoBall);
  const _otherLighting = cleanArray(otherLighting);
  const _djEquipment = cleanArray(djEquipment);
  const _djGearRequired = cleanArray(djGearRequired);

  const hasAny =
    _instrumentSpecs.length ||
    _paAndBackline.length ||
    _backline.length ||
    _paSpeakerSpecs.length ||
    _floorMonitorSpecs.length ||
    _mixingDesk.length ||
    Object.values(vocalMics || {}).some((v) =>
      Boolean((v ?? "").toString().trim())
    ) ||
    Object.values(instrumentMics || {}).some((v) =>
      Boolean((v ?? "").toString().trim())
    ) ||
    Object.values(speechMics || {}).some((v) =>
      Boolean((v ?? "").toString().trim())
    ) ||
    Object.values(inEarMonitoring || {}).some((v) =>
      Boolean((v ?? "").toString().trim())
    ) ||
    _cableLogistics.length ||
    _extensionCableLogistics.length ||
    _uplights.length ||
    _tbars.length ||
    _lightBars.length ||
    _discoBall.length ||
    _otherLighting.length ||
    _djEquipment.length ||
    _djGearRequired.length ||
    (Array.isArray(djEquipmentCategories) && djEquipmentCategories.length > 0) ||
    Object.values(additionalEquipment || {}).some((v) =>
      Boolean((v ?? "").toString().trim())
    );

  // DJ categories chips (booleans to labels)
  const djCat = Array.isArray(djEquipmentCategories)
    ? djEquipmentCategories[0] || {}
    : {};
  const djCategoryChips = [
    djCat.hasDjTable && "DJ Table",
    djCat.hasDjBooth && "DJ Booth",
    djCat.hasMixingConsole && "Mixing Console",
    djCat.hasCdjs && "CDJs",
    djCat.hasVinylDecks && "Vinyl Decks",
  ].filter(Boolean);

  return (
    <section className="bg-white p-6 border rounded shadow-sm space-y-6">
      {!hasAny && (
        <p className="text-gray-400">No equipment information listed yet.</p>
      )}

      {hasAny && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ⬆️ Instrument Specs FIRST */}
          {_instrumentSpecs.length > 0 && (
            <Section title="Instrument Specs">
              <RowList
                items={_instrumentSpecs.map((i, idx) => (
                  <li key={`ins-${idx}`}>{specLine(i)}</li>
                ))}
              />
            </Section>
          )}

          {/* PA & Backline */}
          {(_paAndBackline.length > 0 || _backline.length > 0) && (
            <Section title="PA & Backline">
              <RowList
                items={[
                  ..._paAndBackline.map((i, idx) => (
                    <li key={`pa-${idx}`}>{specLine(i)}</li>
                  )),
                  ..._backline.map((i, idx) => (
                    <li key={`back-${idx}`}>{specLine(i)}</li>
                  )),
                ]}
              />
            </Section>
          )}

          {/* PA Speaker Specs / Floor Monitors / Mixing Desk */}
          {(_paSpeakerSpecs.length > 0 ||
            _floorMonitorSpecs.length > 0 ||
            _mixingDesk.length > 0) && (
            <Section title="PA, Monitors & Desk">
              {_paSpeakerSpecs.length > 0 && (
                <>
                  <h3 className="font-medium text-gray-800 mb-1">PA Speakers</h3>
                  <RowList
                    items={_paSpeakerSpecs.map((i, idx) => (
                      <li key={`pas-${idx}`}>{specLine(i)}</li>
                    ))}
                  />
                </>
              )}
              {_floorMonitorSpecs.length > 0 && (
                <>
                  <h3 className="font-medium text-gray-800 mt-4 mb-1">
                    Floor Monitors
                  </h3>
                  <RowList
                    items={_floorMonitorSpecs.map((i, idx) => (
                      <li key={`mon-${idx}`}>{specLine(i)}</li>
                    ))}
                  />
                </>
              )}
              {_mixingDesk.length > 0 && (
                <>
                  <h3 className="font-medium text-gray-800 mt-4 mb-1">
                    Mixing Desk
                  </h3>
                  <RowList
                    items={_mixingDesk.map((i, idx) => (
                      <li key={`desk-${idx}`}>{specLine(i)}</li>
                    ))}
                  />
                </>
              )}
            </Section>
          )}

          {/* Microphones & Monitoring */}
          {(Object.values(vocalMics).some((v) =>
            Boolean((v ?? "").toString().trim())
          ) ||
            Object.values(instrumentMics).some((v) =>
              Boolean((v ?? "").toString().trim())
            ) ||
            Object.values(speechMics).some((v) =>
              Boolean((v ?? "").toString().trim())
            ) ||
            Object.values(inEarMonitoring).some((v) =>
              Boolean((v ?? "").toString().trim())
            )) && (
            <Section title="Microphones & Monitoring">
              {Object.values(vocalMics).some((v) =>
                Boolean((v ?? "").toString().trim())
              ) && (
                <>
                  <h3 className="font-medium text-gray-800 mb-1">Vocal Mics</h3>
                  <RowList
                    items={[
                      vocalMics.wireless_vocal_mics && (
                        <li key="v1">
                          Wireless vocal mics: {vocalMics.wireless_vocal_mics}
                        </li>
                      ),
                      vocalMics.wired_vocal_mics && (
                        <li key="v2">
                          Wired vocal mics: {vocalMics.wired_vocal_mics}
                        </li>
                      ),
                      vocalMics.wireless_vocal_adapters && (
                        <li key="v3">
                          Wireless vocal adapters:{" "}
                          {vocalMics.wireless_vocal_adapters}
                        </li>
                      ),
                    ].filter(Boolean)}
                  />
                </>
              )}

              {Object.values(instrumentMics).some((v) =>
                Boolean((v ?? "").toString().trim())
              ) && (
                <>
                  <h3 className="font-medium text-gray-800 mt-4 mb-1">
                    Instrument Mics
                  </h3>
                  <RowList
                    items={[
                      instrumentMics.extra_wired_instrument_mics && (
                        <li key="i1">
                          Extra wired instrument mics:{" "}
                          {instrumentMics.extra_wired_instrument_mics}
                        </li>
                      ),
                      instrumentMics.wireless_horn_mics && (
                        <li key="i2">
                          Wireless horn mics: {instrumentMics.wireless_horn_mics}
                        </li>
                      ),
                      instrumentMics.drum_mic_kit && (
                        <li key="i3">
                          Drum mic kit: {instrumentMics.drum_mic_kit}
                        </li>
                      ),
                    ].filter(Boolean)}
                  />
                </>
              )}

              {Object.values(speechMics).some((v) =>
                Boolean((v ?? "").toString().trim())
              ) && (
                <>
                  <h3 className="font-medium text-gray-800 mt-4 mb-1">
                    Speech Mics
                  </h3>
                  <RowList
                    items={[
                      speechMics.wireless_speech_mics && (
                        <li key="s1">
                          Wireless speech mics: {speechMics.wireless_speech_mics}
                        </li>
                      ),
                      speechMics.wired_speech_mics && (
                        <li key="s2">
                          Wired speech mics: {speechMics.wired_speech_mics}
                        </li>
                      ),
                    ].filter(Boolean)}
                  />
                </>
              )}

              {Object.values(inEarMonitoring).some((v) =>
                Boolean((v ?? "").toString().trim())
              ) && (
                <>
                  <h3 className="font-medium text-gray-800 mt-4 mb-1">
                    In-Ear Monitoring
                  </h3>
                  <RowList
                    items={[
                      inEarMonitoring.wired_in_ear_packs && (
                        <li key="m1">
                          Wired IEM packs: {inEarMonitoring.wired_in_ear_packs}
                        </li>
                      ),
                      inEarMonitoring.wireless_in_ear_packs && (
                        <li key="m2">
                          Wireless IEM packs:{" "}
                          {inEarMonitoring.wireless_in_ear_packs}
                        </li>
                      ),
                      inEarMonitoring.in_ear_monitors && (
                        <li key="m3">
                          In-ear monitors: {inEarMonitoring.in_ear_monitors}
                        </li>
                      ),
                    ].filter(Boolean)}
                  />
                </>
              )}
            </Section>
          )}

          {/* Cables */}
          {(_cableLogistics.length > 0 ||
            _extensionCableLogistics.length > 0) && (
            <Section title="Cabling">
              {_cableLogistics.length > 0 && (
                <>
                  <h3 className="font-medium text-gray-800 mb-1">
                    XLRs
                  </h3>
                  <RowList
                    items={_cableLogistics.map((c, idx) => (
                      <li key={`cbl-${idx}`}>{cableLine(c)}</li>
                    ))}
                  />
                </>
              )}
              {_extensionCableLogistics.length > 0 && (
                <>
                  <h3 className="font-medium text-gray-800 mt-4 mb-1">
                    Extension Leads
                  </h3>
                  <RowList
                    items={_extensionCableLogistics.map((c, idx) => (
                      <li key={`ext-${idx}`}>{cableLine(c)}</li>
                    ))}
                  />
                </>
              )}
            </Section>
          )}

          {/* Additional Equipment */}
          {Object.values(additionalEquipment || {}).some((v) =>
            Boolean((v ?? "").toString().trim())
          ) && (
            <Section title="Additional Equipment">
              <RowList
                items={[
                  additionalEquipment.mic_stands && (
                    <li key="ae1">
                      Mic stands: {additionalEquipment.mic_stands}
                    </li>
                  ),
                  additionalEquipment.di_boxes && (
                    <li key="ae2">DI boxes: {additionalEquipment.di_boxes}</li>
                  ),
                  additionalEquipment.wireless_guitar_jacks && (
                    <li key="ae3">
                      Wireless guitar jacks:{" "}
                      {additionalEquipment.wireless_guitar_jacks}
                    </li>
                  ),
                ].filter(Boolean)}
              />
            </Section>
          )}

        {/* Lighting */}
{(_uplights.length > 0 ||
  _tbars.length > 0 ||
  _lightBars.length > 0 ||
  _discoBall.length > 0 ||
  _otherLighting.length > 0) && (
  <Section title="Lighting">
    <RowList
      items={[
        ..._uplights.map((i, idx) => (
          <li key={`upl-${idx}`}>Uplights x {i.quantity}</li>
        )),
        ..._tbars.map((i, idx) => (
          <li key={`tbar-${idx}`}>T-Bars x {i.quantity}</li>
        )),
        ..._lightBars.map((i, idx) => (
          <li key={`lbar-${idx}`}>Light Bars x {i.quantity}</li>
        )),
        ..._discoBall.map((i, idx) => (
          <li key={`dball-${idx}`}>Disco Ball x {i.quantity}</li>
        )),
        ..._otherLighting.map((i, idx) => (
          <li key={`ol-${idx}`}>
            {i.name ? `${i.name} x ${i.quantity}` : `Other Lighting x ${i.quantity}`}
          </li>
        )),
      ]}
    />
  </Section>
)}

          {/* DJ Equipment */}
          {(_djEquipment.length > 0 ||
            _djGearRequired.length > 0 ||
            djCategoryChips.length > 0) && (
            <Section title="DJ Equipment">
              {djCategoryChips.length > 0 && (
                <div className="mb-3">
                  <EquipmentChips items={djCategoryChips} />
                </div>
              )}
              {_djEquipment.length > 0 && (
                <>
                  <h3 className="font-medium text-gray-800 mb-1">
                    Available DJ Gear
                  </h3>
                  <RowList
                    items={_djEquipment.map((i, idx) => (
                      <li key={`djeq-${idx}`}>{specLine(i)}</li>
                    ))}
                  />
                </>
              )}
              {_djGearRequired.length > 0 && (
                <>
                  <h3 className="font-medium text-gray-800 mt-4 mb-1">
                    Venue-Provided / Required
                  </h3>
                  <RowList
                    items={_djGearRequired.map((i, idx) => (
                      <li key={`djreq-${idx}`}>{specLine(i)}</li>
                    ))}
                  />
                </>
              )}
            </Section>
          )}
        </div>
      )}
    </section>
  );
};

export default MusicianEquipment;