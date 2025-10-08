export function cleanEquipmentFields(body, parsedData) {
    const safeParse = (val, fallback) => {
      try {
        if (typeof val === "string") return JSON.parse(val);
        if (typeof val === "object" && val !== null) return val;
        return fallback;
      } catch {
        return fallback;
      }
    };
  
    // --- Clean pa_equipment.other_lighting ---
    const cleanedPaEquipment = safeParse(body.pa_equipment, {});
    if (Array.isArray(cleanedPaEquipment.other_lighting)) {
      cleanedPaEquipment.other_lighting = cleanedPaEquipment.other_lighting.map(item => ({
        name: item?.name?.trim() || "",
        quantity: Number(item?.quantity) || 0,
        wattage: Number(item?.wattage) || 0,
      }));
    }
    parsedData.pa_equipment = cleanedPaEquipment;
  
    // --- Clean all fields inside equipment_spec ---
    const cleanedEquipmentSpec = safeParse(body.equipment_spec, {});
    const fieldsToSanitize = [
      "mixing_desks",
      "pa_speakers",
      "monitors",

    ];
  
    fieldsToSanitize.forEach(key => {
      const arr = safeParse(cleanedEquipmentSpec[key], []);
      if (Array.isArray(arr)) {
        cleanedEquipmentSpec[key] = arr.map(item => ({
          name: item?.name?.trim() || "",
          wattage: Number(item?.wattage) || 0,
        }));
      }
    });
  
    parsedData.equipment_spec = cleanedEquipmentSpec;
  }