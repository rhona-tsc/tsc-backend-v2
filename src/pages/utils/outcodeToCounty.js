 const outcodeToCounty = [
  {
    bedfordshire: [
      "LU1",
      "LU2",
      "LU3",
      "LU4",
      "LU5",
      "LU6",
      "LU7",
      "MK40",
      "MK41",
      "MK42",
      "MK43",
      "MK44",
      "SG15",
      "SG16",
      "SG17",
      "SG18",
      "SG19",
    ],
    berkshire: [
      "RG1",
      "RG2",
      "RG4",
      "RG5",
      "RG6",
      "RG7",
      "RG8",
      "RG10",
      "RG12",
      "RG14",
      "RG17",
      "RG18",
      "RG19",
      "RG20",
      "RG30",
      "RG31",
      "RG40",
      "RG41",
      "RG42",
      "RG45",
      "SL1",
      "SL2",
      "SL3",
      "SL4",
      "SL5",
      "SL6",
      "SL7",
    ],
    buckinghamshire: [
      "HP5",
      "HP6",
      "HP7",
      "HP8",
      "HP9",
      "HP10",
      "HP11",
      "HP12",
      "HP13",
      "HP14",
      "HP15",
      "HP16",
      "HP17",
      "HP18",
      "HP19",
      "HP20",
      "HP21",
      "HP22",
      "HP23",
      "LU6",
      "LU7",
      "MK1",
      "MK2",
      "MK3",
      "MK4",
      "MK5",
      "MK6",
      "MK7",
      "MK8",
      "MK9",
      "MK10",
      "MK11",
      "MK12",
      "MK13",
      "MK14",
      "MK15",
      "MK16",
      "MK17",
      "MK18",
      "MK19",
    ],
    cambridgeshire: [
      "CB1", "CB2", "CB3", "CB4", "CB5", "CB6", "CB7", "CB8", "CB9", "CB10", "CB11", "CB21", "CB22", "CB23", "CB24", "CB25",
      "PE1", "PE2", "PE3", "PE4", "PE5", "PE6", "PE7", "PE8", "PE9", "PE13", "PE14", "PE15", "PE16", "PE19", "PE26", "PE27", "PE28", "PE29"
    ],
    cheshire: [
      "CH1", "CH2", "CH3", "CH4", "CH64", "CH65", "CH66",
      "CW1", "CW2", "CW3", "CW4", "CW5", "CW6", "CW7", "CW8", "CW9", "CW10", "CW11", "CW12",
      "WA1", "WA2", "WA3", "WA4", "WA5", "WA6", "WA7"
    ],
    cornwall: [
      "EX22", "EX23",
      "PL10", "PL11", "PL12", "PL13", "PL14", "PL15", "PL17", "PL18", "PL22", "PL23", "PL24", "PL25", "PL26", "PL27", "PL28", "PL29", "PL30", "PL31", "PL32", "PL33", "PL34", "PL35",
      "TR1", "TR2", "TR3", "TR4", "TR5", "TR6", "TR7", "TR8", "TR9", "TR10", "TR11", "TR12", "TR13", "TR14", "TR15", "TR16", "TR17", "TR18", "TR19", "TR20", "TR21", "TR22", "TR23", "TR24", "TR25", "TR26", "TR27"
    ],
    cumbria: [
      "CA1", "CA2", "CA3", "CA4", "CA5", "CA6", "CA7", "CA8", "CA9",
      "CA10", "CA11", "CA12", "CA13", "CA14", "CA15", "CA16", "CA17", "CA18", "CA19",
      "CA20", "CA21", "CA22", "CA23", "CA24", "CA25", "CA26", "CA27", "CA28", "CA95",
      "CA99",
      "LA5", "LA6", "LA7", "LA8", "LA9", "LA10", "LA11", "LA12", "LA13", "LA14",
      "LA15", "LA16", "LA17", "LA18", "LA19", "LA20", "LA21", "LA22", "LA23"
    ],
    derbyshire: [
      // DE postcode districts primarily in Derbyshire
      "DE1", "DE3", "DE4", "DE5", "DE6", "DE7", "DE11", "DE12", "DE21", "DE22", "DE23", "DE24",
      "DE45", "DE55", "DE56", "DE65", "DE72", "DE73", "DE74", "DE75", "DE99",
    
      // S postcode districts covering parts of Derbyshire
      "S18", "S32", "S33", "S40", "S41", "S42", "S43", "S44", "S45",
    
      // SK postcode districts in Derbyshire
      "SK13", "SK17", "SK22", "SK23",
    
      // NG postcode districts extending into Derbyshire
      "NG10", "NG16", "NG20",
    
      // LE postcode district partially in Derbyshire
      "LE65",
    
      // ST postcode district with minor coverage in Derbyshire
      "ST14"
    ],
    devon: [
      "EX1", "EX2", "EX3", "EX4", "EX5", "EX6", "EX7", "EX8", "EX9", "EX10", "EX11", "EX12", "EX13", "EX14", "EX15", "EX16", "EX17", "EX18", "EX19", "EX20", "EX21", "EX22", "EX23", "EX24", "EX31", "EX32", "EX33", "EX34", "EX35", "EX36", "EX37", "EX38", "EX39",
      "PL1", "PL2", "PL3", "PL4", "PL5", "PL6", "PL7", "PL8", "PL9", "PL16", "PL19", "PL20", "PL21"
    ],
      
    dorset: [
      "BA22",
      "BH16", "BH19", "BH20", "BH21", "BH22", "BH23", "BH31",
      "DT1", "DT2", "DT3", "DT4", "DT5", "DT6", "DT7", "DT8", "DT9", "DT10", "DT11",
      "SP5", "SP6", "SP7", "SP8"
    ],
      
    durham: [
      "DH1", "DH2", "DH3", "DH4", "DH5", "DH6", "DH7", "DH8", "DH9", "DH97", "DH98", "DH99",
      "DL1", "DL2", "DL3", "DL4", "DL5", "DL12", "DL13", "DL14", "DL15", "DL16", "DL17"
    ],
    east_sussex: [
      "BN1", "BN2", "BN3", "BN7", "BN8", "BN9", "BN10", "BN20", "BN21", "BN22", "BN23", "BN24", "BN25", "BN26", "BN27",
      "RH17", "RH18", "RH19",
      "TN3", "TN5", "TN19", "TN20", "TN21", "TN22", "TN31", "TN32", "TN33", "TN34", "TN35", "TN36", "TN37", "TN38", "TN39", "TN40"
    ],
    essex: [
      "CM0", "CM1", "CM2", "CM3", "CM4", "CM5", "CM6", "CM7", "CM8", "CM9", "CM11", "CM12", "CM13", "CM14", "CM15", "CM16", "CM17", "CM18", "CM19", "CM20", "CM21", "CM22", "CM23", "CM24", "CM77",
      "CO1", "CO2", "CO3", "CO4", "CO5", "CO6", "CO7", "CO8", "CO9", "CO10", "CO11", "CO12", "CO13", "CO14", "CO15", "CO16", "CO17", "CO18",
      "SS0", "SS1", "SS2", "SS3", "SS4", "SS5", "SS6", "SS7", "SS8", "SS9", "SS11", "SS12", "SS13", "SS14", "SS15", "SS16", "SS17"
    ],
    gloucestershire: [
      "GL1", "GL2", "GL3", "GL4", "GL5", "GL6", "GL7", "GL8", "GL9", "GL10", "GL11", "GL12", "GL13", "GL14", "GL15", "GL16", "GL17", "GL18", "GL19", "GL20", "GL50", "GL51", "GL52", "GL53", "GL54", "GL55", "GL56"
    ],
    greater_london: [
      "BR1", "BR2", "BR3", "BR4", "BR5", "BR6", "BR7", "BR8",
      "CR0", "CR2", "CR4", "CR5", "CR7", "CR8", "CR9",
      "DA1", "DA5", "DA6", "DA7", "DA8", "DA14", "DA15", "DA16", "DA17", "DA18",
      "E1", "E1W", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9",
      "E10", "E11", "E12", "E13", "E14", "E15", "E16", "E17", "E18", "E20", "E22", "E98",
      "EC1A", "EC1M", "EC1N", "EC1P", "EC1R", "EC1V", "EC1Y",
      "EC2A", "EC2M", "EC2N", "EC2P", "EC2R", "EC2V", "EC2Y",
      "EC3A", "EC3M", "EC3N", "EC3P", "EC3R", "EC3V",
      "EC4A", "EC4M", "EC4N", "EC4P", "EC4R", "EC4V", "EC4Y",
      "EN1", "EN2", "EN3", "EN4", "EN5",
      "HA0", "HA1", "HA2", "HA3", "HA4", "HA5", "HA6", "HA7", "HA8", "HA9",
      "IG1", "IG2", "IG3", "IG4", "IG5", "IG6", "IG7", "IG8", "IG9", "IG10", "IG11",
      "KT1", "KT2", "KT3", "KT4", "KT5", "KT6", "KT7", "KT8", "KT9",
      "N1", "N1C", "N1P", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9",
      "N10", "N11", "N12", "N13", "N14", "N15", "N16", "N17", "N18", "N19", "N20", "N21", "N22", "N81",
      "NW1", "NW1W", "NW2", "NW3", "NW4", "NW5", "NW6", "NW7", "NW8", "NW9", "NW10", "NW11", "NW26",
      "RM1", "RM2", "RM3", "RM4", "RM5", "RM6", "RM7", "RM8", "RM9", "RM10", "RM11", "RM12", "RM13", "RM14", "RM15",
      "SE1", "SE1P", "SE2", "SE3", "SE4", "SE5", "SE6", "SE7", "SE8", "SE9",
      "SE10", "SE11", "SE12", "SE13", "SE14", "SE15", "SE16", "SE17", "SE18", "SE19",
      "SE20", "SE21", "SE22", "SE23", "SE24", "SE25", "SE26", "SE27", "SE28",
      "SM1", "SM2", "SM3", "SM4", "SM5", "SM6", "SM7",
      "SW1A", "SW1E", "SW1H", "SW1P", "SW1V", "SW1W", "SW1X", "SW1Y",
      "SW2", "SW3", "SW4", "SW5", "SW6", "SW7", "SW8", "SW9", "SW10", "SW11", "SW12", "SW13", "SW14", "SW15", "SW16", "SW17", "SW18", "SW19", "SW20", "SW95",
      "TW1", "TW2", "TW3", "TW4", "TW5", "TW6", "TW7", "TW8", "TW9", "TW10", "TW11", "TW12", "TW13", "TW14", "TW15", "TW16", "TW17", "TW18", "TW19", "TW20",
      "UB1", "UB2", "UB3", "UB4", "UB5", "UB6", "UB7", "UB8", "UB9", "UB10", "UB11",
      "W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11", "W12", "W13", "W14",
      "WC1A", "WC1B", "WC1E", "WC1H", "WC1N", "WC1R", "WC1V", "WC1X",
      "WC2A", "WC2B", "WC2E", "WC2H", "WC2N", "WC2R"
    ],
    greater_manchester: [
      "BL0", "BL1", "BL2", "BL3", "BL4", "BL5", "BL6", "BL7", "BL8", "BL9",
      "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M11", "M12", "M13", "M14", "M15", "M16", "M17", "M18", "M19",
      "M20", "M21", "M22", "M23", "M24", "M25", "M26", "M27", "M28", "M29", "M30", "M31", "M32", "M33", "M34", "M35",
      "M38", "M40", "M41", "M43", "M44", "M45", "M46", "M50", "M60", "M90", "M99",
      "OL1", "OL2", "OL3", "OL4", "OL5", "OL6", "OL7", "OL8", "OL9", "OL10", "OL11", "OL12", "OL15", "OL16",
      "SK1", "SK2", "SK3", "SK4", "SK5", "SK6", "SK7", "SK8", "SK14", "SK15", "SK16",
      "WA1", "WA2", "WA3", "WA4", "WA5", "WA14", "WA15",
      "WN1", "WN2", "WN3", "WN4", "WN5", "WN6", "WN7"
    ],
    hampshire: [
      "BH23", "BH24", "BH25",
      "GU10", "GU11", "GU12", "GU13", "GU14", "GU17", "GU26", "GU30", "GU31", "GU32", "GU33", "GU34", "GU35", "GU46",
      "PO7", "PO8", "PO9", "PO10", "PO11", "PO12", "PO13", "PO14", "PO15", "PO16", "PO17",
      "RG19", "RG20", "RG21", "RG22", "RG23", "RG24", "RG25", "RG26", "RG27", "RG28", "RG29",
      "SO16", "SO20", "SO21", "SO22", "SO23", "SO24", "SO30", "SO31", "SO32", "SO40", "SO41", "SO42", "SO43", "SO45", "SO50", "SO51", "SO52", "SO53",
      "SP5", "SP6", "SP10", "SP11"
    ],
    herefordshire: [
      "HR1", "HR2", "HR3", "HR4", "HR5", "HR6", "HR7", "HR8", "HR9"
    ],
    hertfordshire: [
      "AL1", "AL10", "AL2", "AL3", "AL4", "AL5", "AL6", "AL7", "AL8", "AL9",
      "CM20", "CM21", "CM23",
      "EN10", "EN11", "EN5", "EN6", "EN7", "EN8",
      "HA6",
      "HP1", "HP2", "HP23", "HP3", "HP4", "HP5",
      "LU2",
      "SG1", "SG10", "SG11", "SG12", "SG13", "SG14", "SG2", "SG3", "SG4", "SG5", "SG6", "SG7", "SG8", "SG9",
      "WD1", "WD2", "WD3", "WD4", "WD5", "WD6", "WD7"
    ],
    
    isle_of_wight: [
      "PO30", "PO31", "PO32", "PO33", "PO34", "PO35", "PO36", "PO37", "PO38", "PO39", "PO40", "PO41"
    ],
    
    kent: [
      "BR6", "BR8",
      "CT1", "CT10", "CT11", "CT12", "CT13", "CT14", "CT15", "CT16", "CT17", "CT18", "CT19", "CT2", "CT20", "CT21", "CT3", "CT4", "CT5", "CT6", "CT7", "CT8", "CT9",
      "DA1", "DA10", "DA11", "DA12", "DA13", "DA2", "DA3", "DA4", "DA9",
      "ME1", "ME10", "ME11", "ME12", "ME13", "ME14", "ME15", "ME16", "ME17", "ME18", "ME19", "ME2", "ME20", "ME3", "ME4", "ME5", "ME6", "ME7", "ME8", "ME9",
      "TN1", "TN10", "TN11", "TN12", "TN13", "TN14", "TN15", "TN16", "TN17", "TN18", "TN2", "TN23", "TN24", "TN25", "TN26", "TN27", "TN28", "TN29", "TN3", "TN30", "TN4", "TN8", "TN9"
    ],
    lancashire: [
      "BB1", "BB2", "BB3", "BB4", "BB5", "BB6", "BB7", "BB8", "BB9", "BB10", "BB11", "BB12",
      "BB18", "BD23", "BL0", "BL6", "BL7", "FY1", "FY2", "FY3", "FY4", "FY5", "FY6", "FY7", "FY8",
      "L37", "L39", "L40", "LA1", "LA2", "LA3", "LA4", "LA5", "LA6", "OL12", "OL13",
      "PR1", "PR2", "PR3", "PR4", "PR5", "PR6", "PR7", "PR8", "PR9", "WN6", "WN8"
    ],
    
    leicestershire: [
      "LE1", "LE2", "LE3", "LE4", "LE5", "LE6", "LE7", "LE8", "LE9", "LE10", "LE11", "LE12", "LE13",
      "LE14", "LE15", "LE16", "LE17", "LE18", "LE19", "LE21", "LE41", "LE55", "LE65", "LE67", "LE87", "LE94", "LE95",
      "CV9", "CV10", "CV11", "CV13", "DE11", "DE12", "DE73", "DE74", "NG13", "NG32", "NG33"
    ],
    
    lincolnshire: [
      "DN10", "DN14", "DN15", "DN17", "DN18", "DN19", "DN20", "DN21", "DN31", "DN32", "DN33", "DN34", "DN35",
      "DN36", "DN37", "DN38", "DN39", "DN40", "DN41",
      "LN1", "LN2", "LN3", "LN4", "LN5", "LN6", "LN7", "LN8", "LN9", "LN10", "LN11", "LN12", "LN13",
      "NG23", "NG31", "NG32", "NG33", "NG34",
      "PE6", "PE9", "PE10", "PE11", "PE12", "PE13", "PE20", "PE21", "PE22", "PE23", "PE24", "PE25"
    ],
    merseyside: [
      "CH41", "CH42", "CH43", "CH44", "CH45", "CH46", "CH47", "CH48", "CH49",
      "CH60", "CH61", "CH62", "CH63", "CH64", "CH65", "CH66",
      "L3", "L9", "L10", "L12", "L14", "L16", "L17", "L18", "L19", "L20", "L21", "L22", "L23", "L24", "L25", "L26", "L29", "L30", "L31", "L32", "L34", "L35", "L36", "L37", "L38", "L62", "L63",
      "PR8", "PR9",
      "WA8", "WA9", "WA10", "WA11", "WA12",
      "WN4", "WN5"
    ],
    norfolk: [
      "IP20", "IP21", "IP22", "IP24", "IP25", "IP26", "IP27",
      "NR1", "NR2", "NR4", "NR5", "NR6", "NR7", "NR8", "NR9", "NR10", "NR11", "NR12", "NR13", "NR14", "NR15", "NR16", "NR17", "NR18", "NR19", "NR20", "NR21", "NR22", "NR23", "NR24", "NR25", "NR26", "NR27", "NR28", "NR29", "NR30", "NR31", "NR34", "NR35",
      "PE14", "PE30", "PE31", "PE32", "PE33", "PE34", "PE35", "PE36", "PE37", "PE38"
    ],
    north_yorkshire: [
      "BD20", "BD23", "BD24",
      "DL6", "DL7", "DL8", "DL9", "DL10", "DL11",
      "HG1", "HG2", "HG3", "HG4", "HG5",
      "LA2", "LA6", "LA10",
      "LS21", "LS22", "LS23", "LS24", "LS25",
      "TS9", "TS10", "TS11", "TS13", "TS14",
      "YO1", "YO7", "YO8", "YO10", "YO11", "YO12", "YO13", "YO14", "YO15", "YO16", "YO17", "YO18", "YO19", "YO21", "YO22", "YO23", "YO24", "YO25", "YO26", "YO30", "YO31", "YO32", "YO41", "YO42", "YO43", "YO51", "YO60", "YO61", "YO62"
    ],
    northamptonshire: [
      "NN1", "NN2", "NN3", "NN4", "NN5", "NN6", "NN7", "NN8", "NN9", "NN10",
      "NN11", "NN12", "NN13", "NN14", "NN15", "NN16", "NN17", "NN18", "NN29",
      "CV23", "LE15", "LE16", "MK19", "OX17", "PE8", "PE9"
    ],
    
    northumberland: [
      "CA6", "CA9", "DH8", "NE15", "NE18", "NE19", "NE20", "NE22", "NE23", "NE24",
      "NE25", "NE26", "NE41", "NE42", "NE43", "NE44", "NE45", "NE46", "NE47", "NE48",
      "NE49", "NE61", "NE62", "NE63", "NE64", "NE65", "NE66", "NE67", "NE68", "NE69",
      "NE70", "NE71", "TD12", "TD15"
    ],
    
    nottinghamshire: [
      "NG1", "NG2", "NG3", "NG4", "NG5", "NG6", "NG7", "NG8", "NG9", "NG11",
      "NG12", "NG13", "NG14", "NG15", "NG16", "NG17", "NG18", "NG19", "NG20",
      "NG21", "NG22", "NG23", "NG24", "NG25", "DN10", "DN11", "DN22", "LE12",
      "LE14", "S80", "S81"
    ],
    oxfordshire: [
      "GL56", "GL7", "MK18", "NN13",
      "OX1", "OX2", "OX3", "OX4", "OX5", "OX6", "OX7", "OX8", "OX9",
      "OX10", "OX11", "OX12", "OX13", "OX14", "OX15", "OX16", "OX17", "OX18",
      "OX20", "OX25", "OX26", "OX27", "OX28", "OX29", "OX33", "OX39", "OX44", "OX49",
      "RG4", "RG8", "RG9", "SN6", "SN7"
    ],
    
    rutland: [
      "LE15", "LE16"
    ],
    
    shropshire: [
      "CW3",
      "DY12", "DY14",
      "LD7",
      "LL14",
      "SY1", "SY2", "SY3", "SY4", "SY5", "SY6", "SY7", "SY8", "SY9",
      "SY10", "SY11", "SY12", "SY13", "SY15", "SY21", "SY22",
      "TF1", "TF2", "TF3", "TF4", "TF5", "TF6", "TF7", "TF8", "TF9", "TF10", "TF11", "TF12", "TF13",
      "WR15",
      "WV5", "WV6", "WV7", "WV15", "WV16"
    ],
    somerset: [
      "BA1", "BA2", "BA3", "BA4", "BA5", "BA6", "BA7", "BA8", "BA9", "BA10", "BA11", "BA16", "BA20", "BA21", "BA22",
      "BS18", "BS24", "BS25", "BS26", "BS27", "BS28",
      "DT9",
      "EX35",
      "TA1", "TA2", "TA3", "TA4", "TA5", "TA6", "TA7", "TA8", "TA9", "TA10", "TA11", "TA12", "TA13", "TA14", "TA15", "TA16", "TA17", "TA18", "TA19", "TA20", "TA21", "TA22", "TA23", "TA24"
    ],
    south_yorkshire: [
      "DN1", "DN3", "DN4", "DN5", "DN6", "DN7", "DN8", "DN9", "DN10", "DN11", "DN12", "DN14",
      "S1", "S2", "S5", "S6", "S8", "S9", "S10", "S12", "S13", "S17", "S19", "S30", "S31", "S35",
      "S60", "S61", "S62", "S63", "S64", "S65", "S66", "S70", "S71", "S72", "S73", "S74", "S75", "S80", "S81",
      "WF8"
    ],
    staffordshire: [
      "B74", "B75", "B77", "B78", "B79",
      "CW2", "CW3",
      "DE6", "DE13", "DE14", "DE15",
      "DY3", "DY7",
      "SK11", "SK17",
      "ST3", "ST4", "ST5", "ST6", "ST7", "ST8", "ST9", "ST10", "ST11", "ST12", "ST13", "ST14", "ST15", "ST16", "ST17", "ST18", "ST19", "ST20", "ST21",
      "TF9", "TF10", "TF11",
      "WS3", "WS6", "WS7", "WS9", "WS11", "WS12", "WS13", "WS14", "WS15",
      "WV4", "WV5", "WV6", "WV8", "WV9", "WV10", "WV11", "WV15"
    ],
    suffolk: [
      "IP1", "IP2", "IP3", "IP4", "IP5", "IP6", "IP7", "IP8", "IP9", "IP10",
      "IP11", "IP12", "IP13", "IP14", "IP15", "IP16", "IP17", "IP18", "IP19",
      "IP20", "IP21", "IP22", "IP23", "IP24", "IP25", "IP26", "IP27", "IP28",
      "IP29", "IP30", "IP31", "IP32", "IP33"
    ],
    surrey: [
      "CR3", "CR5", "CR6",
      "GU1", "GU2", "GU3", "GU4", "GU5", "GU6", "GU7", "GU8", "GU9", "GU10",
      "GU11", "GU12", "GU13", "GU14", "GU15", "GU16", "GU17", "GU18", "GU19",
      "GU20", "GU21", "GU22", "GU23", "GU24", "GU25", "GU26", "GU27", "GU28",
      "GU29", "GU30", "GU31", "GU32", "GU33", "GU34", "GU35", "GU46", "GU47",
      "GU51", "GU52",
      "KT1", "KT2", "KT3", "KT4", "KT5", "KT6", "KT7", "KT8", "KT9", "KT10",
      "KT11", "KT12", "KT13", "KT14", "KT15", "KT16", "KT17", "KT18", "KT19",
      "KT20", "KT21", "KT22", "KT23", "KT24",
      "RH1", "RH2", "RH3", "RH4", "RH5", "RH6", "RH7", "RH8", "RH9", "RH10",
      "RH11", "RH12", "RH13", "RH14", "RH15", "RH16", "RH17", "RH18", "RH19",
      "RH20",
      "SM7", "TN8", "TN16", "TW15", "TW16", "TW17", "TW18", "TW19", "TW20"
    ],
    tyne_and_wear: [
      "DH3", "DH4", "DH5",
      "NE1", "NE2", "NE3", "NE4", "NE5", "NE6", "NE7", "NE8", "NE9", "NE10",
      "NE11", "NE12", "NE13", "NE15", "NE16", "NE17", "NE21", "NE23", "NE25",
      "NE26", "NE27", "NE28", "NE29", "NE30", "NE31", "NE32", "NE33", "NE34",
      "NE35", "NE36", "NE37", "NE38", "NE39", "NE40", "NE99",
      "SR1", "SR2", "SR3", "SR4", "SR5", "SR6"
    ],
    warwickshire: [
      "B49", "CV8", "CV9", "CV10", "CV11", "CV12", "CV21", "CV22", "CV23", "CV31", "CV32",
      "CV33", "CV34", "CV35", "CV36", "LE10", "WR11"
    ],
    
    west_midlands: [
      "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13", "B14",
      "B15", "B16", "B17", "B18", "B19", "B20", "B21", "B23", "B24", "B25", "B26", "B27", "B28",
      "B29", "B30", "B31", "B32", "B33", "B34", "B35", "B36", "B37", "B38", "B42", "B43", "B44",
      "B45", "B62", "B63", "B66", "B67", "B68", "B69", "B70", "B71", "B72", "B73", "B74", "B75",
      "B76", "B90", "B91", "B92", "B93", "B94", "DY1", "DY2", "DY3", "DY4", "DY5", "DY6", "DY8",
      "DY9", "WS1", "WS2", "WS3", "WS4", "WS5", "WS6", "WS7", "WS8", "WS9", "WV1", "WV2", "WV3",
      "WV4", "WV5", "WV6", "WV10", "WV11", "WV12", "WV13", "WV14"
    ],
    
    west_sussex: [
      "BN5", "BN6", "BN11", "BN12", "BN13", "BN14", "BN15", "BN16", "BN17", "BN18", "GU6",
      "GU27", "GU28", "GU29", "GU30", "PO18", "PO19", "PO20", "PO21", "PO22", "RH10", "RH11",
      "RH12", "RH13", "RH14", "RH15", "RH16", "RH17", "RH19"
    ],
    west_yorkshire: [
      "BD1", "BD2", "BD3", "BD4", "BD5", "BD6", "BD7", "BD8", "BD9", "BD10", "BD11", "BD12", "BD13", "BD14", "BD15", "BD16", "BD17", "BD18", "BD19",
      "HD1", "HD2", "HD3", "HD4", "HD5", "HD6", "HD7", "HD8", "HD9",
      "HX1", "HX2", "HX3", "HX4", "HX5", "HX6", "HX7",
      "LS1", "LS2", "LS3", "LS4", "LS5", "LS6", "LS7", "LS8", "LS9", "LS10", "LS11", "LS12", "LS13", "LS14", "LS15", "LS16", "LS17", "LS18", "LS19", "LS20", "LS21", "LS22", "LS23", "LS24", "LS25", "LS26", "LS27", "LS28", "LS29",
      "WF1", "WF2", "WF3", "WF4", "WF5", "WF6", "WF7", "WF8", "WF9", "WF10", "WF11", "WF12", "WF13", "WF14", "WF15", "WF16", "WF17"
    ],
    wiltshire: [
      "BA12", "BA13", "BA14", "BA15",
      "GL8",
      "RG17",
      "SN1", "SN2", "SN3", "SN4", "SN5", "SN6", "SN7", "SN8", "SN9", "SN10", "SN11", "SN12", "SN13", "SN14", "SN15", "SN16",
      "SP1", "SP2", "SP3", "SP4", "SP5", "SP7", "SP9", "SP11"
    ],
    worcestershire: [
      "WR1", "WR2", "WR3", "WR4", "WR5", "WR6", "WR7", "WR8", "WR9", "WR10", "WR11", "WR12", "WR13", "WR14", "WR15", "WR78", "WR99",
      "B60", "B61", "B62", "B96", "B97", "B98",
      "DY9", "DY10", "DY11", "DY12", "DY13", "DY14",
      "GL20"
    ],
    carmarthenshire: [
      "SA14", "SA15", "SA16", "SA17", "SA18", "SA19", "SA20",
      "SA31", "SA32", "SA33", "SA34", "SA38", "SA39", "SA40",
      "SA44", "SA48", "SA66"
    ],
    
    ceredigion: [
      "SA38", "SA40", "SA43", "SA44", "SA45", "SA46", "SA47", "SA48",
      "SY20", "SY23", "SY24", "SY25"
    ],
    
    conwy: [
      "LL16", "LL17", "LL18", "LL19", "LL20", "LL21", "LL22", "LL23",
      "LL24", "LL25", "LL26", "LL27", "LL28", "LL29", "LL30", "LL31",
      "LL32", "LL33", "LL34"
    ],
    denbighshire: [
      "CH7", "LL11", "LL15", "LL16", "LL17", "LL18", "LL19", "LL20", "LL21", "LL22"
    ],
    flintshire: [
      "CH1", "CH4", "CH5", "CH6", "CH7", "CH8", "LL11", "LL12", "LL18", "LL19"
    ],
    gwynedd: [
      "LL21", "LL23", "LL33", "LL35", "LL36", "LL37", "LL38", "LL39", "LL40", "LL41",
      "LL42", "LL43", "LL44", "LL45", "LL46", "LL47", "LL48", "LL49", "LL51", "LL52",
      "LL53", "LL54", "LL55", "LL56", "LL57", "SY20"
    ],
    monmouthshire: [
      "NP4", "NP5", "NP6", "NP7", "NP15", "NP16", "NP25", "NP26"
    ],
    pembrokeshire: [
      "SA34", "SA35", "SA36", "SA37", "SA41", "SA42", "SA43",
      "SA61", "SA62", "SA63", "SA64", "SA65", "SA66", "SA67",
      "SA68", "SA69", "SA70", "SA71", "SA72", "SA73"
    ],
    powys: [
      "CF44", "CF48", "HR3", "HR5", "LD1", "LD2", "LD3", "LD4",
      "LD5", "LD6", "LD7", "LD8", "NP7", "NP8", "SA9", "SA10",
      "SA11", "SY5", "SY10", "SY15", "SY16", "SY17", "SY18",
      "SY19", "SY20", "SY21", "SY22"
    ],
    rhondda_cynon_taf: [
      "CF15", "CF35", "CF37", "CF38", "CF39", "CF40", "CF41", "CF42",
      "CF43", "CF44", "CF45", "CF72"
    ],
    
    swansea: [
      "SA1", "SA2", "SA3", "SA4", "SA5", "SA6", "SA7", "SA8", "SA9",
      "SA10", "SA11", "SA12", "SA13", "SA14", "SA15", "SA16", "SA17",
      "SA18", "SA19", "SA20", "SA31", "SA32", "SA33", "SA34", "SA35",
      "SA36", "SA37", "SA38", "SA39", "SA40", "SA41", "SA42", "SA43",
      "SA44", "SA45", "SA46", "SA47", "SA48", "SA61", "SA62", "SA63",
      "SA64", "SA65", "SA66", "SA67", "SA68", "SA69", "SA70", "SA71",
      "SA72", "SA73"
    ],
    
    torfaen: [
      "NP4", "NP44", "NP6"
    ],
    neath_port_talbot: [
      "SA8", "SA9", "SA10", "SA11", "SA12", "SA13", "SA18"
    ],
    
    bridgend: [
      "CF31", "CF32", "CF33", "CF34", "CF35", "CF36"
    ],
    
    blaenau_gwent: [
      "NP13", "NP22", "NP23"
    ],
    caerphilly: [
      "CF3", "CF46", "CF81", "CF82", "CF83", "NP1", "NP2"
    ],
    cardiff: [
      "CF3", "CF5", "CF10", "CF11", "CF14", "CF15", "CF23", "CF24"
    ],
    merthyr_tydfil: [
      "CF46", "CF47", "CF48"
    ],
    newport: [
      "NP10", "NP11", "NP18", "NP19", "NP20"
    ],
    
    wrexham: [
      "LL11", "LL12", "LL13", "LL14", "LL20", "SY13", "SY14"
    ],
    
    west_glamorgan: [
      "SA1", "SA2", "SA3", "SA4", "SA5", "SA6", "SA7", "SA8", "SA9", "SA10", "SA11", "SA12", "SA13"
    ],
    aberdeen_city: [
      "AB10", "AB11", "AB12", "AB13", "AB14", "AB15", "AB16",
      "AB21", "AB22", "AB23", "AB24", "AB25"
    ],
    
    aberdeenshire: [
      "AB30", "AB31", "AB32", "AB33", "AB34", "AB35", "AB36",
      "AB37", "AB38", "AB39", "AB41", "AB42", "AB43", "AB44",
      "AB45", "AB51", "AB52", "AB53", "AB54", "AB55", "AB56"
    ],
    
    angus: [
      "AB30", "DD2", "DD3", "DD4", "DD5", "DD7", "DD8", "DD9",
      "DD10", "DD11", "PH11", "PH12", "PH13", "PH14"
    ],
    argyll_and_bute: [
      "FK20", "G82", "G83", "G84",
      "PA20", "PA21", "PA22", "PA23", "PA24", "PA25", "PA26", "PA27", "PA28", "PA29",
      "PA30", "PA31", "PA32", "PA33", "PA34", "PA35", "PA36", "PA37", "PA38", "PA41",
      "PA42", "PA43", "PA44", "PA45", "PA46", "PA47", "PA48", "PA49", "PA60", "PA61",
      "PA62", "PA63", "PA64", "PA65", "PA66", "PA67", "PA68", "PA69", "PA70", "PA71",
      "PA72", "PA73", "PA74", "PA75", "PA76", "PA77", "PA78"
    ],
    clackmannanshire: [
      "FK10", "FK11", "FK12", "FK13", "FK14"
    ],
    dumfries_and_galloway: [
      "DG1", "DG2", "DG3", "DG4", "DG5", "DG6", "DG7", "DG8", "DG9", "DG10",
      "DG11", "DG12", "DG13", "DG14", "DG16", "KA6", "ML12"
    ],
    dundee_city: [
      "DD1", "DD2", "DD3", "DD4", "DD5"
    ],
    
    east_ayrshire: [
      "KA1", "KA2", "KA3", "KA4", "KA5", "KA6", "KA16", "KA17", "KA18", "KA19", "DG7"
    ],
    
    east_dunbartonshire: [
      "G61", "G62", "G64", "G65", "G66"
    ],
    east_lothian: [
      "EH21", "EH31", "EH32", "EH33", "EH34", "EH35", "EH36",
      "EH39", "EH40", "EH41", "EH42", "TD13"
    ],
    
    east_renfrewshire: [
      "G46", "G76", "G77", "G78"
    ],
    
    edinburgh: [
      "EH1", "EH2", "EH3", "EH4", "EH5", "EH6", "EH7", "EH8", "EH9", "EH10",
      "EH11", "EH12", "EH13", "EH14", "EH15", "EH16", "EH17", "EH28", "EH29", "EH30"
    ],
    falkirk: [
      "FK1", "FK2", "FK3", "FK4", "FK5", "FK6", "FK7", "FK10", "FK11", "FK12", "FK13", "FK14", "FK15", "FK16", "FK17", "FK18", "FK19", "FK20", "FK21"
    ],
    
    fife: [
      "DD6", "FK10", "KY1", "KY2", "KY3", "KY4", "KY5", "KY6", "KY7", "KY8", "KY9", "KY10", "KY11", "KY12", "KY13", "KY14", "KY15", "KY16"
    ],
    
    glasgow: [
      "G1", "G2", "G3", "G4", "G5", "G11", "G12", "G13", "G14", "G15", "G20", "G21", "G22", "G23", "G31", "G32", "G33", "G34", "G40", "G41", "G42", "G43", "G44", "G45", "G46", "G51", "G52", "G53", "G60", "G61", "G62", "G63", "G64", "G65", "G66", "G67", "G68", "G69", "G71", "G72", "G73", "G74", "G75", "G76", "G77", "G78", "G81", "G82", "G83", "G84"
    ],
    highland: [
      "AB37",
      "IV1", "IV2", "IV3", "IV4", "IV5", "IV6", "IV7", "IV8", "IV9", "IV10", "IV11", "IV12", "IV13", "IV14", "IV15", "IV16", "IV17", "IV18", "IV19", "IV20", "IV21", "IV22", "IV23", "IV24", "IV25", "IV26", "IV27", "IV28", "IV40", "IV41", "IV42", "IV43", "IV44", "IV45", "IV46", "IV47", "IV48", "IV49", "IV51", "IV52", "IV53", "IV54", "IV55", "IV56", "IV63",
      "KW1", "KW2", "KW3", "KW8", "KW9", "KW13", "KW14",
      "PH19", "PH20", "PH21", "PH22", "PH23", "PH24", "PH25", "PH26", "PH30", "PH31", "PH32", "PH33", "PH34", "PH35", "PH36", "PH37", "PH38", "PH39", "PH40", "PH41", "PH42", "PH43", "PH44", "PH45", "PH46", "PH47", "PH48", "PH49", "PH50"
    ],
    inverclyde: [
      "PA10", "PA11", "PA13", "PA14", "PA15", "PA16", "PA18", "PA19"
    ],
    midlothian: [
      "EH10", "EH16", "EH17", "EH18", "EH19", "EH20", "EH22", "EH23", "EH24", "EH25", "EH26", "EH37", "EH38"
    ],
    moray: [
      "AB37", "AB38", "AB45", "AB54", "AB55", "AB56",
      "IV30", "IV31", "IV32", "IV36",
      "PH26"
    ],
    
    na_h_eileanan_siar: [
      "HS1", "HS2", "HS3", "HS4", "HS5", "HS6", "HS7", "HS8", "HS9"
    ],
    
    north_ayrshire: [
      "KA11", "KA12", "KA13", "KA14", "KA15", "KA20", "KA21", "KA22", "KA23", "KA24",
      "KA25", "KA27", "KA28", "KA29", "KA30", "PA17"
    ],
    north_lanarkshire: [
      "G33", "G65", "G66", "G67", "G68", "G69", "G71",
      "ML1", "ML2", "ML4", "ML5", "ML6", "ML7"
    ],
    
    orkney_islands: [
      "KW15", "KW16", "KW17"
    ],
    
    perth_and_kinross: [
      "DD2",
      "FK14", "FK15", "FK19", "FK21",
      "KY13",
      "PH1", "PH2", "PH3", "PH4", "PH5", "PH6", "PH7",
      "PH8", "PH9", "PH10", "PH11", "PH12", "PH13", "PH14",
      "PH15", "PH16", "PH17", "PH18"
    ],
    renfrewshire: [
      "PA1", "PA2", "PA3", "PA4", "PA5", "PA6", "PA7", "PA8", "PA9", "PA10", "PA11", "PA12", "PA14"
    ],
    
    scottish_borders: [
      "EH38", "EH43", "EH44", "EH45", "EH46",
      "TD1", "TD2", "TD3", "TD4", "TD5", "TD6", "TD7", "TD8", "TD9", "TD10", "TD11", "TD12", "TD13", "TD14", "TD15"
    ],
    
    shetland_islands: [
      "ZE1", "ZE2", "ZE3"
    ],
    south_ayrshire: [
      "KA1", "KA2", "KA5", "KA6", "KA7", "KA8", "KA9", "KA10", "KA19", "KA26"
    ],
    
    south_lanarkshire: [
      "EH46", "EH55",
      "G71", "G72", "G73", "G74", "G75",
      "ML3", "ML8", "ML9", "ML10", "ML11", "ML12"
    ],
    
    stirling: [
      "FK6", "FK7", "FK8", "FK9", "FK15", "FK16", "FK17", "FK18", "FK19", "FK20", "FK21", "G63"
    ],
    west_dunbartonshire: [
      "G60", "G81", "G82", "G83"
    ],
    
    west_lothian: [
      "EH27", "EH30", "EH47", "EH48", "EH49", "EH52", "EH53", "EH54", "EH55"
    ]

  },
];

export default outcodeToCounty;