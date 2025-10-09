import React, { useState, useMemo } from "react";
import dayjs from "dayjs";

const roundToNearest5 = (time) => {
  const minutes = time.minute();
  const roundedMinutes = Math.round(minutes / 5) * 5;
  return time.minute(roundedMinutes).second(0);
};

const DynamicTimetable = ({ actData }) => {
  const [startTime, setStartTime] = useState("19:30");
  const [setOption, setSetOption] = useState("3x40");

  const setupTime = actData?.setupAndSoundcheck?.setup_time || 60;
  const soundcheckTime = actData?.setupAndSoundcheck?.soundcheck_time || 30;
  const changeTime = 15;
  const mealTime = 30;

  const timetable = useMemo(() => {
    const times = [];
    const performanceStartTime = roundToNearest5(dayjs(`2023-01-01T${startTime}`));
    const setupStartTime = roundToNearest5(performanceStartTime
      .subtract(mealTime, "minute")
      .subtract(changeTime, "minute")
      .subtract(soundcheckTime, "minute")
      .subtract(setupTime, "minute")
    );

    const endTimeLimit = roundToNearest5(setupStartTime.add(7, "hour"));
    const midnight = dayjs("2023-01-02T00:00");
    const endTime = endTimeLimit.isBefore(midnight) ? endTimeLimit : midnight;

    let currentTime = performanceStartTime;

    times.push({ activity: `Setup (${setupTime} mins)`, time: setupStartTime.format("HH:mm") });
    times.push({ activity: `Soundcheck (${soundcheckTime} mins)`, time: roundToNearest5(setupStartTime.add(setupTime, "minute")).format("HH:mm") });
    times.push({ activity: `Change Time (${changeTime} mins)`, time: roundToNearest5(setupStartTime.add(setupTime + soundcheckTime, "minute")).format("HH:mm") });
    times.push({ activity: `Band Meal (${mealTime} mins) / Playlist`, time: roundToNearest5(setupStartTime.add(setupTime + soundcheckTime + changeTime, "minute")).format("HH:mm") });

    let remainingTime = endTime.diff(performanceStartTime, "minute");
    const setDurations = setOption === "3x40" ? [40, 40, 40] : [60, 60];
    const playlistCount = setDurations.length - 1;
    const setsTotalTime = setDurations.reduce((a, b) => a + b, 0);
    const playlistTime = playlistCount > 0 ? Math.max(30, Math.min(50, Math.floor((remainingTime - setsTotalTime) / playlistCount / 5) * 5)) : 0;

    setDurations.forEach((duration, index) => {
      times.push({ activity: `${index + 1}${setOption === "3x40" ? "st" : "nd"} Live Set (${duration} mins)`, time: currentTime.format("HH:mm") });
      currentTime = roundToNearest5(currentTime.add(duration, "minute"));
      if (index < playlistCount) {
        times.push({ activity: `Playlist (${playlistTime} mins)`, time: currentTime.format("HH:mm") });
        currentTime = roundToNearest5(currentTime.add(playlistTime, "minute"));
      }
    });

    times.push({ activity: endTime.isSame(midnight) ? "Finish (Midnight)" : "Finish (7-hour limit)", time: endTime.format("HH:mm") });

    return times;
  }, [startTime, setOption, setupTime, soundcheckTime]);

  return (
    <div className="p-4 border rounded-lg mt-6">
      <h2 className="text-lg font-semibold mb-4">Performance Timetable</h2>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Select Performance Start Time:</label>
        <input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          className="border p-2 rounded"
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Choose Set Option:</label>
        <select
          value={setOption}
          onChange={(e) => setSetOption(e.target.value)}
          className="border p-2 rounded"
        >
          <option value="3x40">3 x 40 mins</option>
          <option value="2x60">2 x 60 mins</option>
        </select>
      </div>

      <div className="overflow-x-auto mt-6">
        <table className="min-w-full border border-gray-300 text-sm text-left">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-4 py-2">Activity</th>
              <th className="border px-4 py-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {timetable.map(({ activity, time }, idx) => (
              <tr key={idx}>
                <td className="border px-4 py-2">{activity}</td>
                <td className="border px-4 py-2">{time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DynamicTimetable;