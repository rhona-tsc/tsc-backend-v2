import React from "react";

const CustomTimePicker = ({
  value,
  onChange,
  maxHourAM = 3,
  enableDayOffset = false,
  dayOffset = 0,
  onDayOffsetChange, // still supported by the day select
  // Minimum time constraint (optional)
  minHHMM = null, // e.g. "18:45"
  minDayOffset = 0, // 0 = event day, 1 = next day
  minuteStep = 5,
  // NEW: read-only/disabled mode + placeholders + default meridiem
  disabled = false,
  hourPlaceholder = "Hour",
  minutePlaceholder = "Minute",
  defaultPeriod = "PM",
}) => {
  // ---- helpers ----
  const parseHHMM24 = (s) => {
    if (!s || typeof s !== "string" || !s.includes(":")) return { h: 0, m: 0 };
    const [h, m] = s.split(":").map(Number);
    return { h: (h || 0) % 24, m: (m || 0) % 60 };
  };

  const h12To24 = (h12, ampm) => {
    const h = parseInt(h12, 10) || 0;
    if (ampm === "AM") return h % 12; // 12AM -> 0
    return (h % 12) + 12; // 12PM -> 12
  };

  const nextStep = (mm, step) => {
    const s = Math.max(1, step);
    const r = mm % s;
    return r === 0 ? mm : mm + (s - r);
  };

  // ---- parsing/formatting ----
  const parseTime = (timeStr) => {
    if (!timeStr || typeof timeStr !== "string" || !timeStr.includes(":")) {
      return { hour: "", minute: "", ampm: defaultPeriod === "AM" ? "AM" : "PM" };
    }
    const [rawHour, rawMinute] = timeStr.split(":");
    let h = parseInt(rawHour, 10);
    const m = rawMinute.substring(0, 2);
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return { hour: h.toString(), minute: m, ampm: ap };
  };

  const formatTime = (hour, minute, ampm) => {
    if (hour === "" || minute === "" || ampm === "") return "";
    let h = parseInt(hour, 10);
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return `${h.toString().padStart(2, "0")}:${minute}`;
  };

  let hour, minute, ampm;
  const isEmptyValue = !value;
  if (isEmptyValue) {
    // Default UI when there is no value yet (purely visual; no side-effect)
    hour = "";
    minute = "";
    ampm = defaultPeriod === "AM" ? "AM" : "PM";
  } else {
    ({ hour, minute, ampm } = parseTime(value));
  }

  // If next day is selected, force AM (no PM allowed next day)
  if (enableDayOffset && Number(dayOffset) === 1) {
    ampm = "AM";
  }

  // ---- hour options (AM/PM + optional next-day) ----
  const hourOptionsForMeridiem = (ampm, enableDayOffset, dayOffset) => {
    if (ampm === "AM") {
      if (!enableDayOffset || Number(dayOffset) === 0) {
        // Event Day: 9–11 AM
        return [9, 10, 11];
      }
      // Next Day: 12–3 AM
      return [12, 1, 2, 3];
    }
    // PM (only valid for Event Day)
    return [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  };

  // ---- min boundary (in minutes from event-day 00:00) ----
  const { h: minH24, m: minM } = parseHHMM24(minHHMM || "00:00");
  const minFloorMinutes = (Number(minDayOffset) || 0) * 1440 + minH24 * 60;

  // ---- change handler ----
  const handleChange = (field, newValue) => {
    if (disabled) return; // respect read-only mode

    let newHour = field === "hour" ? newValue : hour;
    const newMinute = field === "minute" ? newValue : minute;
    let newAmpm = field === "ampm" ? newValue : ampm;

    // Force AM on next day
    if (enableDayOffset && Number(dayOffset) === 1) newAmpm = "AM";

    // Clamp AM hours to maxHourAM when not 12
    if (newAmpm === "AM") {
      const h = parseInt(newHour || 0, 10);
      if (!Number.isNaN(h) && h !== 12 && h > maxHourAM) {
        newHour = maxHourAM.toString();
      }
    }

    const formatted = formatTime(newHour, newMinute, newAmpm);
    onChange(formatted || "");
  };

  // ---- apply min constraints to options ----
  const baseHours = hourOptionsForMeridiem(ampm, enableDayOffset, dayOffset);
  const filteredHours = baseHours.filter((h) => {
    const optionHour24 = h12To24(h, ampm);
    const optionFloor = (Number(dayOffset) || 0) * 1440 + optionHour24 * 60;
    if (optionFloor === minFloorMinutes) {
      // keep only if at least one minute slot remains in this hour
      return nextStep(minM, minuteStep) < 60;
    }
    return optionFloor >= minFloorMinutes;
  });

  const selectedHour24 = h12To24(hour, ampm);
  const selectedHourFloor = (Number(dayOffset) || 0) * 1440 + selectedHour24 * 60;
  const minMinuteForThisHour =
    selectedHourFloor === minFloorMinutes ? nextStep(minM, minuteStep) : 0;

  const minuteOptions = Array.from(
    { length: Math.floor(60 / Math.max(1, minuteStep)) },
    (_, i) => String(i * Math.max(1, minuteStep)).padStart(2, "0")
  ).filter((mm) => parseInt(mm, 10) >= minMinuteForThisHour);

  // ---- render ----
  // ---- render ----
  const colsClass = enableDayOffset ? "grid-cols-4" : "grid-cols-3";

  return (
    <div className={`grid ${colsClass} gap-2 sm:flex sm:flex-wrap sm:items-center`}>
      <select
        className="w-full sm:w-auto min-w-0 border px-2 py-1 rounded text-sm text-gray-700"
        value={hour}
        onChange={(e) => handleChange("hour", e.target.value)}
        disabled={disabled}
      >
        <option value="">{hourPlaceholder}</option>
        {filteredHours.map((h) => (
          <option key={h} value={String(h)}>{h}</option>
        ))}
      </select>

      <select
        className="w-full sm:w-auto min-w-0 border px-2 py-1 rounded text-sm text-gray-700"
        value={minute}
        onChange={(e) => handleChange("minute", e.target.value)}
        disabled={disabled}
      >
        <option value="">{minutePlaceholder}</option>
        {minuteOptions.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>

      <select
        className="w-full sm:w-auto min-w-0 border px-2 py-1 rounded text-sm text-gray-700"
        value={ampm}
        onChange={(e) => handleChange("ampm", e.target.value)}
        disabled={disabled}
      >
        <option value="AM">AM</option>
        {(!enableDayOffset || Number(dayOffset) === 0) && <option value="PM">PM</option>}
      </select>

      {enableDayOffset && (
        <select
          className="w-full sm:w-auto min-w-0 border px-2 py-1 rounded text-sm text-gray-700"
          value={String(dayOffset)}
          onChange={(e) => onDayOffsetChange?.(parseInt(e.target.value, 10) || 0)}
          title="Select day for this time"
          disabled={disabled}
        >
          <option value="0">Event day</option>
          <option value="1">Next day</option>
        </select>
      )}
    </div>
  );
};

export default CustomTimePicker;