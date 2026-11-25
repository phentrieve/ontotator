/**
 * A small hand-labelled sample for the segment aligner (issue 560): invented English discharge letters and German
 * translations of the kind a translation pipeline delivers. No real patient. Each entry is one gold pair; a text is
 * its parts joined by a space ("\n\n" where a part starts with "¶ ", a new paragraph; none after a part that ends a
 * line). Gold pairs are the finest pairs whose cuts exist on both sides: a sentence or line end, or a clause cut
 * (after a semicolon, or after a comma in a long sentence) where the other side has a cut too.
 */
export interface GoldPair { en: string; de: string }
export interface GoldDocument { name: string; pairs: GoldPair[] }

export const ALIGNMENT_SAMPLE: GoldDocument[] = [
  { name: "discharge letter, neurology", pairs: [
    { en: "We are reporting on Ms. A., born 12.03.1961, who was treated as an inpatient from 4 to 11 May.", de: "Wir berichten über Frau A., geb. 12.03.1961, die sich vom 4. bis 11. Mai in unserer stationären Behandlung befand." },
    { en: "She was admitted with a sudden weakness of the right arm and slurred speech that had started two hours earlier.", de: "Die Aufnahme erfolgte wegen einer plötzlichen Schwäche des rechten Arms und einer verwaschenen Sprache. Die Beschwerden hatten zwei Stunden zuvor begonnen." },
    { en: "On admission, the blood pressure was 182/96 mmHg and the heart rate 88/min.", de: "Bei Aufnahme betrug der Blutdruck 182/96 mmHg, die Herzfrequenz 88/min." },
    { en: "The NIHSS score was 6.", de: "Der NIHSS-Score lag bei 6." },
    { en: "Cranial CT showed no bleeding.", de: "In der kranialen CT zeigte sich keine Blutung." },
    { en: "CT angiography showed an occlusion of the left middle cerebral artery (M2 segment).", de: "Die CT-Angiographie zeigte einen Verschluss der linken A. cerebri media (M2-Segment)." },
    { en: "We started systemic thrombolysis with alteplase 0.9 mg/kg 140 minutes after the onset of symptoms.", de: "Wir begannen 140 Minuten nach Symptombeginn eine systemische Thrombolyse mit Alteplase 0,9 mg/kg." },
    { en: "The symptoms improved within 24 hours; ", de: "Die Symptomatik besserte sich innerhalb von 24 Stunden." },
    { en: "at discharge, only a mild fine motor weakness of the right hand remained.", de: "Bei Entlassung bestand nur noch eine leichte feinmotorische Schwäche der rechten Hand." },
    { en: "¶ The MRI on day 2 showed a small infarct in the left insula.", de: "¶ Das MRT am zweiten Tag zeigte einen kleinen Infarkt der linken Insel." },
    { en: "Long-term ECG monitoring over 72 hours revealed paroxysmal atrial fibrillation.", de: "Im Langzeit-EKG über 72 Stunden fand sich ein paroxysmales Vorhofflimmern." },
    { en: "Transthoracic echocardiography was normal, with an ejection fraction of 60%.", de: "Die transthorakale Echokardiographie war unauffällig, die Ejektionsfraktion betrug 60 %." },
    { en: "We therefore started anticoagulation with apixaban 5 mg twice daily on day 4.", de: "Wir begannen daher am vierten Tag eine Antikoagulation mit Apixaban 5 mg zweimal täglich." },
    { en: "Please check the blood pressure regularly. The target is below 130/80 mmHg.", de: "Bitte kontrollieren Sie den Blutdruck regelmäßig mit einem Zielwert unter 130/80 mmHg." },
    { en: "A follow-up appointment in our stroke clinic is planned in three months.", de: "Ein Kontrolltermin in unserer Schlaganfallambulanz ist in drei Monaten geplant." },
  ] },
  { name: "discharge letter, paediatrics", pairs: [
    { en: "Diagnoses: community-acquired pneumonia of the right lower lobe; ", de: "Diagnosen: ambulant erworbene Pneumonie des rechten Unterlappens; " },
    { en: "dehydration.", de: "Dehydratation." },
    { en: "The 4-year-old boy presented with fever up to 39.8 °C for three days, cough and reduced fluid intake.", de: "Der 4-jährige Junge stellte sich mit Fieber bis 39,8 °C seit drei Tagen, Husten und verminderter Trinkmenge vor." },
    { en: "On examination, he was tachypnoeic at 42/min with crackles over the right lower field.", de: "Bei der Untersuchung war er tachypnoisch mit 42/min. Über dem rechten Unterfeld waren feinblasige Rasselgeräusche zu hören." },
    { en: "Oxygen saturation was 93% on room air.", de: "Die Sauerstoffsättigung lag unter Raumluft bei 93 %." },
    { en: "Laboratory tests showed a CRP of 86 mg/l and leukocytes of 18.4/nl with left shift.", de: "Laborchemisch zeigte sich ein CRP von 86 mg/l. Die Leukozyten lagen bei 18,4/nl mit Linksverschiebung." },
    { en: "The chest X-ray confirmed an infiltrate in the right lower lobe without effusion.", de: "Das Röntgenbild des Thorax bestätigte ein Infiltrat im rechten Unterlappen ohne Erguss." },
    { en: "We treated him with ampicillin i.v. 100 mg/kg/day in three doses and with intravenous fluids.", de: "Wir behandelten ihn mit Ampicillin i.v. 100 mg/kg/Tag in drei Einzeldosen sowie mit einer intravenösen Flüssigkeitsgabe." },
    { en: "He was afebrile from day 3.", de: "Ab dem dritten Tag war er fieberfrei." },
    { en: "After 48 hours without fever, we switched to oral amoxicillin.", de: "Nach 48 Stunden Fieberfreiheit stellten wir auf orales Amoxicillin um." },
    { en: "¶ Recommendations: amoxicillin 90 mg/kg/day in two doses until 14 May; ", de: "¶ Empfehlungen: Amoxicillin 90 mg/kg/Tag in zwei Einzeldosen bis zum 14. Mai." },
    { en: "follow-up with the paediatrician in two to three days; ", de: "Kontrolle beim Kinderarzt in zwei bis drei Tagen." },
    { en: "return if breathing gets worse or he drinks too little.", de: "Wiedervorstellung bei Verschlechterung der Atmung oder zu geringer Trinkmenge." },
    { en: "Did the parents understand the dosing?", de: "Haben die Eltern die Dosierung verstanden?" },
    { en: "Yes, we explained it with the measuring syringe.", de: "Ja, wir haben sie anhand der Messspritze erklärt." },
  ] },
  { name: "outpatient letter, endocrinology", pairs: [
    { en: "Thank you for referring Mr. B. for poorly controlled type 2 diabetes.", de: "Vielen Dank für die Überweisung von Herrn B. wegen eines schlecht eingestellten Diabetes mellitus Typ 2." },
    { en: "His HbA1c is 9.1% despite metformin 1000 mg twice daily and sitagliptin 100 mg once daily.", de: "Das HbA1c beträgt 9,1 % trotz Metformin 1000 mg zweimal täglich und Sitagliptin 100 mg einmal täglich." },
    { en: "He reports polyuria and a weight loss of 4 kg over two months.", de: "Er berichtet über Polyurie und einen Gewichtsverlust von 4 kg in zwei Monaten." },
    { en: "There are no hypoglycaemic episodes.", de: "Hypoglykämien treten nicht auf." },
    { en: "On examination, his BMI is 31.2 kg/m², blood pressure 138/84 mmHg.", de: "Bei der Untersuchung beträgt der BMI 31,2 kg/m², der Blutdruck 138/84 mmHg." },
    { en: "The foot examination shows reduced vibration sense on both sides (4/8).", de: "Die Fußuntersuchung zeigt ein beidseits vermindertes Vibrationsempfinden (4/8)." },
    { en: "Pulses are palpable.", de: "Die Pulse sind tastbar." },
    { en: "The eGFR is 74 ml/min/1.73 m²; the urine albumin-to-creatinine ratio is 42 mg/g.", de: "Die eGFR liegt bei 74 ml/min/1,73 m², der Albumin-Kreatinin-Quotient im Urin bei 42 mg/g." },
    { en: "We recommend adding empagliflozin 10 mg once daily.", de: "Wir empfehlen die zusätzliche Gabe von Empagliflozin 10 mg einmal täglich." },
    { en: "Sitagliptin can be stopped if a GLP-1 receptor agonist is started later.", de: "Sitagliptin kann beendet werden, falls später ein GLP-1-Rezeptoragonist begonnen wird." },
    { en: "He should drink enough fluids and pause empagliflozin on sick days, for example with vomiting or fever.", de: "Er sollte ausreichend trinken. An Krankheitstagen, z. B. bei Erbrechen oder Fieber, sollte Empagliflozin pausiert werden." },
    { en: "We will see him again in three months with a new HbA1c.", de: "Eine Wiedervorstellung mit aktuellem HbA1c ist in drei Monaten vorgesehen." },
  ] },
  { name: "operation report, surgery", pairs: [
    { en: "Indication: acute cholecystitis with gallstones, symptoms for 36 hours.", de: "Indikation: akute Cholezystitis bei Cholezystolithiasis, Beschwerden seit 36 Stunden." },
    { en: "Procedure: laparoscopic cholecystectomy under general anaesthesia.", de: "Eingriff: laparoskopische Cholezystektomie in Intubationsnarkose." },
    { en: "We placed four trocars in the usual position.", de: "Es erfolgte die Anlage von vier Trokaren in typischer Position." },
    { en: "The gallbladder was distended and inflamed, with adhesions to the omentum.", de: "Die Gallenblase war prall gefüllt und entzündlich verändert. Es bestanden Verwachsungen zum Omentum." },
    { en: "After dissection of Calot's triangle, the critical view of safety was achieved.", de: "Nach Präparation des Calot-Dreiecks wurde die Critical View of Safety dargestellt." },
    { en: "The cystic duct and the cystic artery were clipped twice and divided.", de: "Ductus cysticus und A. cystica wurden jeweils doppelt geclippt und durchtrennt." },
    { en: "The gallbladder was removed from the liver bed with the hook and taken out in a bag through the umbilical incision.", de: "Die Gallenblase wurde mit dem Haken aus dem Leberbett gelöst und im Bergebeutel über den Nabelschnitt geborgen." },
    { en: "Blood loss was minimal (< 50 ml).", de: "Der Blutverlust war minimal (< 50 ml)." },
    { en: "No drain was placed.", de: "Eine Drainage wurde nicht eingelegt." },
    { en: "¶ Postoperative course: paracetamol 1 g up to four times daily, metamizole as needed; ", de: "¶ Postoperativer Verlauf: Paracetamol 1 g bis zu viermal täglich, bei Bedarf Metamizol; " },
    { en: "full diet from the evening of surgery.", de: "Kostaufbau ab dem Abend des OP-Tages." },
    { en: "The patient can be discharged on day 2 if the laboratory values are normal.", de: "Bei unauffälligen Laborwerten ist die Entlassung am zweiten postoperativen Tag möglich." },
    { en: "Sutures are removed by the family doctor after 10 days.", de: "Die Fadenentfernung erfolgt nach 10 Tagen durch den Hausarzt." },
  ] },
];

/**
 * A second sample, written after the aligner was tuned on the first and never tuned on: harder cases (a dropped
 * sentence, reordered clauses, comma enumerations, lists, more splits and joins).
 */
export const ALIGNMENT_HELD_OUT: GoldDocument[] = [
  { name: "discharge letter, cardiology", pairs: [
    { en: "Mr. C., 67 years old, was admitted on 2 March via the emergency department with chest pain at rest for 40 minutes.", de: "Herr C., 67 Jahre, wurde am 2. März über die Notaufnahme aufgenommen. Er hatte seit 40 Minuten Ruhe-Brustschmerzen." },
    { en: "The ECG showed ST elevations in II, III and aVF.", de: "Im EKG zeigten sich ST-Hebungen in II, III und aVF." },
    { en: "Troponin T was 412 ng/l.", de: "Das Troponin T lag bei 412 ng/l." },
    { en: "Coronary angiography showed a proximal occlusion of the right coronary artery, which was treated with a drug-eluting stent (3.5 × 18 mm).", de: "Die Koronarangiographie zeigte einen proximalen Verschluss der rechten Koronararterie, der mit einem medikamentenfreisetzenden Stent (3,5 × 18 mm) versorgt wurde." },
    { en: "The left anterior descending artery had a 50% stenosis, which we will reassess.", de: "Der Ramus interventricularis anterior wies eine 50%ige Stenose auf, die wir erneut beurteilen werden." },
    { en: "The further course was uneventful.", de: "Der weitere Verlauf gestaltete sich komplikationslos." },
    { en: "He was mobilised on day 1.", de: "Die Mobilisation erfolgte am ersten Tag." },
    { en: "Echocardiography before discharge showed a mildly reduced ejection fraction of 48% with hypokinesia of the inferior wall.", de: "Echokardiographisch zeigte sich vor Entlassung eine leicht eingeschränkte Ejektionsfraktion von 48 %. Es bestand eine Hypokinesie der Hinterwand." },
    { en: "¶ Medication at discharge: acetylsalicylic acid 100 mg once daily, ticagrelor 90 mg twice daily for 12 months, ", de: "¶ Entlassungsmedikation: Acetylsalicylsäure 100 mg einmal täglich, Ticagrelor 90 mg zweimal täglich für 12 Monate, " },
    { en: "atorvastatin 80 mg in the evening, ramipril 2.5 mg twice daily and bisoprolol 2.5 mg once daily.", de: "Atorvastatin 80 mg abends, Ramipril 2,5 mg zweimal täglich und Bisoprolol 2,5 mg einmal täglich." },
    { en: "Please check potassium and creatinine in one week.", de: "Bitte kontrollieren Sie Kalium und Kreatinin in einer Woche." },
    { en: "Cardiac rehabilitation has been requested.", de: "Eine kardiologische Rehabilitation wurde beantragt." },
    { en: "He was advised to stop smoking.", de: "" },
    { en: "An LDL cholesterol below 55 mg/dl is the target.", de: "Zielwert ist ein LDL-Cholesterin unter 55 mg/dl." },
  ] },
  { name: "consultation, dermatology", pairs: [
    { en: "We saw the 34-year-old patient for an itchy rash on both forearms that has been present for six weeks.", de: "Wir sahen die 34-jährige Patientin wegen eines juckenden Ausschlags an beiden Unterarmen, der seit sechs Wochen besteht." },
    { en: "On examination, there were sharply demarcated, erythematous plaques with silvery scales, up to 4 cm in size.", de: "Bei der Untersuchung fanden sich scharf begrenzte, erythematöse Plaques mit silbrigen Schuppen bis 4 cm Größe." },
    { en: "The nails showed pitting.", de: "An den Nägeln zeigten sich Tüpfelnägel." },
    { en: "Her father has psoriasis.", de: "Der Vater leidet an einer Psoriasis." },
    { en: "We diagnosed plaque psoriasis (BSA about 5%, PASI 6.2).", de: "Wir diagnostizierten eine Psoriasis vulgaris vom Plaque-Typ (BSA ca. 5 %, PASI 6,2)." },
    { en: "As treatment, we recommend a combination of calcipotriol and betamethasone as a foam once daily for four weeks, then twice weekly.", de: "Therapeutisch empfehlen wir eine Kombination aus Calcipotriol und Betamethason als Schaum einmal täglich für vier Wochen. Danach soll die Anwendung zweimal wöchentlich erfolgen." },
    { en: "If this is not enough, phototherapy is an option.", de: "Reicht dies nicht aus, kommt eine Lichttherapie in Frage." },
    { en: "Does she have joint pain?", de: "Bestehen Gelenkschmerzen?" },
    { en: "She reports morning stiffness of the fingers for about 20 minutes.", de: "Sie berichtet über eine Morgensteifigkeit der Finger von etwa 20 Minuten." },
    { en: "We therefore suggest a rheumatology referral to rule out psoriatic arthritis.", de: "Wir empfehlen daher eine rheumatologische Vorstellung zum Ausschluss einer Psoriasis-Arthritis." },
  ] },
  { name: "discharge letter, internal medicine", pairs: [
    { en: "Diagnoses:\n", de: "Diagnosen:\n" },
    { en: "- urosepsis with E. coli\n", de: "- Urosepsis mit E. coli\n" },
    { en: "- acute kidney injury (KDIGO 2)\n", de: "- akute Nierenschädigung (KDIGO 2)\n" },
    { en: "- type 2 diabetes", de: "- Diabetes mellitus Typ 2" },
    { en: "¶ The 78-year-old woman was brought in by ambulance with fever of 39.4 °C, confusion and a blood pressure of 85/50 mmHg.", de: "¶ Die 78-jährige Patientin wurde mit Fieber von 39,4 °C, Verwirrtheit und einem Blutdruck von 85/50 mmHg vom Rettungsdienst gebracht." },
    { en: "Lactate was 3.8 mmol/l.", de: "Das Laktat betrug 3,8 mmol/l." },
    { en: "After blood cultures were taken, we started piperacillin/tazobactam 4.5 g three times daily and gave 2 l of crystalloid fluid.", de: "Nach Abnahme von Blutkulturen begannen wir mit Piperacillin/Tazobactam 4,5 g dreimal täglich. Zusätzlich verabreichten wir 2 l kristalloide Flüssigkeit." },
    { en: "Blood pressure stabilised within six hours.", de: "Der Blutdruck stabilisierte sich innerhalb von sechs Stunden." },
    { en: "E. coli grew in the blood and urine cultures; ", de: "In Blut- und Urinkulturen wuchs E. coli." },
    { en: "it was sensitive to ceftriaxone.", de: "Der Erreger war sensibel auf Ceftriaxon." },
    { en: "We switched to ceftriaxone 2 g once daily on day 3.", de: "Am dritten Tag stellten wir auf Ceftriaxon 2 g einmal täglich um." },
    { en: "Creatinine rose to 2.9 mg/dl and fell to 1.3 mg/dl by discharge.", de: "Das Kreatinin stieg auf 2,9 mg/dl an und fiel bis zur Entlassung auf 1,3 mg/dl." },
    { en: "Metformin was paused.", de: "Metformin wurde pausiert." },
    { en: "It can be restarted if the eGFR stays above 45 ml/min.", de: "Es kann wieder angesetzt werden, wenn die eGFR über 45 ml/min bleibt." },
    { en: "The antibiotic is to be continued orally with cefpodoxime 200 mg twice daily until 18 June, i.e. for 10 days in total.", de: "Die antibiotische Therapie ist oral mit Cefpodoxim 200 mg zweimal täglich bis zum 18. Juni fortzuführen, d. h. insgesamt 10 Tage." },
  ] },
  { name: "report, physiotherapy", pairs: [
    { en: "The patient attended eight sessions after a total knee replacement on the left side.", de: "Der Patient nahm nach Implantation einer Knie-Totalendoprothese links an acht Behandlungen teil." },
    { en: "At the start, flexion was 75° and extension lacked 10°.", de: "Zu Beginn betrug die Flexion 75°, in der Extension fehlten 10°." },
    { en: "Now flexion is 110° and extension is complete.", de: "Jetzt liegt die Flexion bei 110°. Die Extension ist frei." },
    { en: "He walks without crutches for up to 500 m; ", de: "Er geht ohne Unterarmgehstützen bis zu 500 m." },
    { en: "stairs are possible with the handrail.", de: "Treppensteigen ist mit Handlauf möglich." },
    { en: "Pain is 2/10 at rest and 4/10 under load.", de: "Die Schmerzen liegen in Ruhe bei 2/10 und unter Belastung bei 4/10." },
    { en: "We recommend six more sessions, focusing on strength and balance, and a home exercise programme twice daily.", de: "Wir empfehlen sechs weitere Behandlungen mit Schwerpunkt auf Kraft und Gleichgewicht sowie ein Heimübungsprogramm zweimal täglich." },
  ] },
];

/** The text of one side of a document, and the gold spans of its pairs in it. */
export function sampleText(document: GoldDocument, side: "en" | "de"): { text: string; spans: { start: number; end: number }[] } {
  let text = "";
  const spans: { start: number; end: number }[] = [];
  document.pairs.forEach((pair, index) => {
    let part = pair[side];
    if (part.startsWith("¶ ")) { part = part.slice(2); if (index > 0) text = text.trimEnd() + "\n\n"; }
    else if (index > 0 && !text.endsWith("\n")) text += text.endsWith(" ") ? "" : " ";
    const body = part.trim();
    if (!body) { const at = text.trimEnd().length; text = text.slice(0, at) + (at ? " " : ""); spans.push({ start: text.length, end: text.length }); return; }
    const start = text.length;
    text += part;
    spans.push({ start, end: start + body.length });
  });
  return { text, spans };
}
