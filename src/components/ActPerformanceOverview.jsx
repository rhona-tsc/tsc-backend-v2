import React, { useState } from "react";
import { assets } from "../assets/assets";

const ActPerformanceOverview = ({ actData }) => {
  const [selectedLineupIndex, setSelectedLineupIndex] = useState(0);

  if (!actData) return null;

  const {
    numberOfSets,
    lengthOfSets,
    minimumIntervalLength,
    pli,
    pliAmount,
    patCert,
    electricityRequirements,
    usesGenericRiskAssessment,
    vatRegistered,
    bestseller,
    paSystem,
    lightingSystem,
    offRepertoireRequests,
    lineups,
    tscName,
  } = actData;

  const selectedLineup = lineups?.[selectedLineupIndex];

  const renderRow = (label, value) => (
    <li>
      <strong>{label}:</strong> {value}
    </li>
  );

  const paDescriptions = {
    smallPA: `${actData.tscName} comes with a compact PA system (up to 500 watts), ideal for background music or intimate indoor gatherings of up to 50 guests. Not recommended for dancing or outdoor use.`,

    mediumPA: `${actData.tscName} provides a medium-sized PA system (501–1000 watts), well-suited for indoor events of up to 100 guests or laid-back outdoor performances. A great fit for amplified vocals and acoustic sets.`,

    largePA: `${actData.tscName} delivers a high-powered PA system (1001+ watts), perfect for large indoor venues or outdoor events with 100+ guests. Designed for full band amplification and energetic, dancefloor-filling music.`,
  };

  const lightingDescriptions = {
    smallLight: `${actData.tscName} includes subtle lighting such as uplighters or simple light bars — great for adding soft ambiance in smaller or more relaxed settings.`,

    mediumLight: `${actData.tscName} features a versatile lighting rig with a disco T-bar and ambient light bars — ideal for medium-sized venues and dance floors needing a stylish party glow.`,

    largeLight: `${actData.tscName} brings a full-scale lighting setup, often with two disco T-bars, moving heads, uplighters, and an LED disco ball — perfect for making a big visual impact at large events and weddings.`,
  };

  const generateDescription = (lineup) => {
    const count = lineup.actSize || lineup.bandMembers.length;

    const instruments = lineup.bandMembers
      .filter((m) => m.isEssential)
      .map((m) => m.instrument)
      .filter(Boolean);

    instruments.sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const isVocal = (str) => str.includes("vocal");
      const isDrums = (str) => str === "drums";

      if (isVocal(aLower) && !isVocal(bLower)) return -1;
      if (!isVocal(aLower) && isVocal(bLower)) return 1;
      if (isDrums(aLower)) return 1;
      if (isDrums(bLower)) return -1;
      return 0;
    });

    const formatWithAnd = (arr) => {
      const unique = [...new Set(arr)];
      if (unique.length === 0) return "";
      if (unique.length === 1) return unique[0];
      if (unique.length === 2) return `${unique[0]} & ${unique[1]}`;
      return `${unique.slice(0, -1).join(", ")} & ${unique[unique.length - 1]}`;
    };

    const roles = lineup.bandMembers.flatMap((member) =>
      (member.additionalRoles || [])
        .filter((r) => r.isEssential)
        .map((r) => r.role || r.role || "Unnamed Service")
    );

    if (count === 0) return "Add a Lineup";

    const instrumentsStr = formatWithAnd(instruments);
    const rolesStr = roles.length
      ? ` (including ${formatWithAnd(roles)} services)`
      : "";

    return `${count}: ${instrumentsStr}${rolesStr}`;
  };

  return (
    <section className="bg-white p-6 border rounded shadow-sm space-y-6">
      <p className="text-gray-600 text-[17px]">
        When it comes to planning an unforgettable event, it’s the finer details
        that make all the difference. Here’s everything you need to know to
        understand exactly what to expect and how {tscName} will seamlessly fit
        into your special day.
      </p>
      <h2 className="text-xl font-semibold  border-b-2 border-gray-300 pb-1 mb-3 text-gray-600">
        Key Timings for a Smooth Event
      </h2>
      <div className="text-gray-600 text-[17px]">
        <strong>Set Structure:</strong>{" "}
        {numberOfSets?.[0] && lengthOfSets?.[0]
          ? `${numberOfSets[0]} x ${lengthOfSets[0]} minute sets`
          : "Set details TBC"}
        {minimumIntervalLength?.[0] &&
          ` with at least ${minimumIntervalLength[0]} minute break(s)`}
        {numberOfSets?.[1] && lengthOfSets?.[1] && (
          <>
            {" "}
            <strong>or</strong>{" "}
            {`${numberOfSets[1]} x ${lengthOfSets[1]} minute sets`}
            {minimumIntervalLength?.[1] &&
              ` with at least ${minimumIntervalLength[1]} minute break(s)`}
          </>
        )}
      </div>

      <div className="text-gray-600 text-[17px]">
        <strong>Setup & Packdown:</strong> {tscName} takes{" "}
        {lineups?.[0]?.setupTime || "TBC"} mins to setup (loading in, putting
        things in place, and plugging everything in),{" "}
        {lineups?.[0]?.soundcheckTime || "TBC"} mins to soundcheck (the louder
        bit where the band will perform songs at full volume level to get the
        acoustics right for your space), and{" "}
        {lineups?.[0]?.packdownTime || "TBC"} mins to packdown.
      </div>

      <div className="text-gray-600 text-[17px]">
        <strong>Other Timings:</strong> Please kindly note that{" "}
        {actData.tscName} requests a 30 minute meal break, and 15 minutes to
        change into their perfoming outfits.
      </div>

      <h2 className="text-xl font-semibold  border-b-2 border-gray-300 pb-1 mb-3 text-gray-600">
        Power, Sound & Lighting
      </h2>
      <div className="text-gray-600 text-[17px]">
        <strong>PA & Sound:</strong>{" "}
        {paSystem
          ? `${paDescriptions[paSystem] || "Description not available"}`
          : "Not specified"}
      </div>

      <div className="text-gray-600 text-[17px]">
        <strong>Lighting:</strong>{" "}
        {lightingSystem
          ? `${lightingDescriptions[lightingSystem] || "Description not available"}`
          : "Not specified"}
      </div>

      <div className="text-gray-600 text-[17px]">
        <strong>Electricity Requirements:</strong> Requires access to{" "}
        {lineups?.[0]?.electricityRequirements ||
          electricityRequirements ||
          "Not specified"}
      </div>
      <h2 className="text-xl font-semibold border-b-2 border-gray-300 pb-1 mb-4 text-gray-600">
        Peace of Mind, Guaranteed
      </h2>

      <div className="flex gap-6">
        {/* Risk Assessment */}
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <img
            src={assets.tick}
            alt="Tick icon"
            className="w-6 h-6 mt-1 shrink-0"
          />
          <div className="text-gray-600 text-[17px]">
            <strong>Risk Assessment</strong>
            <p className="text-base">
              {usesGenericRiskAssessment
                ? "Risk assessment provided"
                : "Bespoke risk assessment provided"}
            </p>
          </div>
        </div>

        {/* PAT Certified */}
        {patCert && (
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <img
              src={assets.tick}
              alt="Tick icon"
              className="w-6 h-6 mt-1 shrink-0"
            />
            <div className="text-gray-600 text-[17px]">
              <strong>PAT Certified</strong>
              <p className="text-base">Certified safe for use at events</p>
            </div>
          </div>
        )}

        {/* PLI */}
        {pli && (
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <img
              src={assets.tick}
              alt="Tick icon"
              className="w-6 h-6 mt-1 shrink-0"
            />
            <div className="text-gray-600 text-[17px]">
              <strong>Public Liability Insurance</strong>
              <p className="text-base">Up to £{pliAmount} million</p>
            </div>
          </div>
        )}

        {/* VAT */}
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <img
            src={assets.vat}
            alt="VAT icon"
            className="w-6 h-6 mt-1 shrink-0"
          />
          <div className="text-gray-600 text-[17px]">
            <strong>No Hidden Charges</strong>
            <p className="text-base">
              VAT is included and applicable to {vatRegistered ? "100%" : "25%"} of the booking
              value
            </p>
          </div>
        </div>
      </div>

      {lineups?.length > 0 && (
        <>
         
          <h2 className="text-xl font-semibold  border-b-2 border-gray-300 pb-1 mb-3 text-gray-600">
Lineup Details & Requirements      </h2>

    <div className="flex flex-wrap gap-3">
      {lineups.map((lineup, index) => (
        <button
          key={index}
          className={`px-4 py-2 border rounded text-base transition-colors duration-200 ${
            index === selectedLineupIndex
              ? "bg-black text-white border-black"
              : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-[#ff6667] hover:text-white hover:border-[#ff6667]"
          }`}
          onClick={() => setSelectedLineupIndex(index)}
        >
          {lineup.actSize || `Lineup ${index + 1}`}
        </button>
      ))}
    </div>

<div className="mt-4">
  <h4 className="text-base  mb-4 text-gray-600">
{selectedLineup ? generateDescription(selectedLineup) : null}
      
  </h4>

  <div className="flex flex-wrap gap-6">
{/* Power, Sound & Lighting Section */}
    <div className="w-full md:w-[48%]">
      <h2 className="text-xl font-semibold border-b-2 border-gray-300 pb-1 mb-3 text-gray-600">
        Sound & Setup Versatility
      </h2>
      <ul className="list-disc pl-5 space-y-1 text-[17px] text-gray-600">
            {selectedLineup?.db && renderRow("Sound Limiter Friendly", `Performs seamlessly with limters as low as ${selectedLineup.db}`)}
        {selectedLineup?.acoustic && renderRow("Acoustic Performance Option", "Stripped-back acoustic performance available")}
        {selectedLineup?.ampless && renderRow("Ampless Setup", "Can perform without on-stage amps for quieter venues")}
        {selectedLineup?.iems && renderRow("Professional Monitoring", "In-ear monitors used for clean, polished sound")}
        {selectedLineup?.eDrums && renderRow("Electronic Drums Available", "Perfect for sound-limited venues")}
        {selectedLineup?.withoutDrums && renderRow("Drum-Free Option", "Can perform without a drummer if required")}
        {selectedLineup?.anotherVocalist && renderRow("Extra Vocal Power", "Additional vocalist can be added")}
        {selectedLineup?.roamingPercussion && renderRow("Roaming Entertainment", "Live percussionist available for immersive experiences")}
      </ul>
    </div>

    {/* Rider Section */}
    <div className="w-full md:w-[48%]">
      <h2 className="text-xl font-semibold border-b-2 border-gray-300 pb-1 mb-3 text-gray-600">
        The Rider
      </h2>
      <ul className="list-disc pl-5 space-y-1 text-base text-gray-600 text-[17px]">
        {renderRow("Performance Space", selectedLineup?.spaceRequired || "TBC")}
        {renderRow("Sustenance", selectedLineup?.hotMeal ? `${selectedLineup.hotMeal} hot meals requested` : "TBC")}
        {selectedLineup?.changingRoom && renderRow("Private Changing Area", "Also known as a Green Room")}
        {selectedLineup?.parking && renderRow("Parking", `${selectedLineup.parking} vehicle spaces requested`)}
        {selectedLineup?.coverOverhead && renderRow("Weather Protection", "A covered performance area")}
        {selectedLineup?.dryAndLevel && renderRow("Safe Performance Surface", "Flat, dry surface needed for equipment")}
        {selectedLineup?.rider?.length > 0 &&
          renderRow("Additional Rider Items", selectedLineup.rider.join(", "))
        }
      </ul>
    </div>

    

  </div>
</div>
        </>
      )}
    </section>
  );
};

export default ActPerformanceOverview;
