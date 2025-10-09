export const getPossessiveTitleCase = (name) => {
    if (!name) return '';
    const upperName = name.toUpperCase();
    const suffix = upperName.endsWith('S') ? "'" : "'S";
    return `${upperName}${suffix}`;
  };