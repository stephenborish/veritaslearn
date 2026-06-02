import fs from 'fs';

const filePath = 'src/services/dbService.ts';
let code = fs.readFileSync(filePath, 'utf8');

const replacement = `
  async scoreAndSubmitAnswersBatch(
    sessionId: string,
    studentId: string,
    studentName: string,
    answers: { q: Question; answer: any; reflection?: any }[]
  ): Promise<void> {
    if (!answers.length) return;
    const safeName = studentName || "Unknown Student";

    // Prepare processed data for each answer
    const processedAnswers = answers.map(({ q, answer, reflection }) => {
      let isCorrect: boolean | null = null;
      let points = 0;
      let partialCredit = false;
      const maxPoints = q.points || 1;

      try {
        if (q.type === "mc") {
          const caseSensitive = !!q.answerSpec?.caseSensitive;
          const correctIndices = q.correctIndices || [];
          const correctTexts = correctIndices.map((idx) =>
            this._normalizeMCText(q.choices![idx], caseSensitive),
          );

          const selRaw = Array.isArray(answer) ? answer : [answer];
          const sel = [
            ...new Set(
              selRaw.map((a) => this._normalizeMCText(a, caseSensitive)),
            ),
          ].filter(Boolean);

          let correctCount = 0;
          let incorrectCount = 0;

          sel.forEach((ans) => {
            if (correctTexts.some((k) => this._mcTextMatches(ans, k)))
              correctCount++;
            else incorrectCount++;
          });

          if (correctTexts.length <= 1) {
            isCorrect = correctCount === 1 && incorrectCount === 0;
            points = isCorrect ? maxPoints : 0;
          } else {
            const denom = Math.max(1, correctTexts.length);
            const rawScore = correctCount / denom - incorrectCount / denom;
            points = Math.max(0, Math.round(maxPoints * rawScore * 100) / 100);
            isCorrect =
              correctCount === correctTexts.length && incorrectCount === 0;
            partialCredit = points > 0 && points < maxPoints;
          }
        } else if (q.type === "sa") {
          const res = this._gradeStructuredSA(q, answer);
          isCorrect = res.isCorrect;
          points = res.points;
        }
      } catch (e) {
        console.error("Scoring error:", e);
      }

      return {
        q,
        data: {
          sessionId,
          studentId,
          studentName: safeName,
          questionId: q.id,
          qIndex: q.qIndex || 0,
          answer,
          isCorrect,
          points,
          maxPoints,
          partialCredit,
          reflection,
          submittedAt: new Date().toISOString(),
        }
      };
    });

    const colRef = collection(db, "responses");

    // Firestore "in" query requires chunks of up to 30.
    const chunks = [];
    for (let i = 0; i < processedAnswers.length; i += 30) {
      chunks.push(processedAnswers.slice(i, i + 30));
    }

    const batch = writeBatch(db);

    for (const chunk of chunks) {
      const questionIds = chunk.map(pa => pa.q.id);
      const qResp = query(
        colRef,
        where("sessionId", "==", sessionId),
        where("studentId", "==", studentId),
        where("questionId", "in", questionIds)
      );

      const snap = await getDocs(qResp);

      // Map existing responses by questionId
      const existingMap = new Map<string, DocumentData>();
      snap.docs.forEach(doc => {
        existingMap.set(doc.data().questionId, doc);
      });

      for (const { q, data } of chunk) {
        const existingDoc = existingMap.get(q.id);

        if (!existingDoc) {
          data.history = [
            {
              answer: data.answer,
              submittedAt: data.submittedAt,
              points: data.points,
              isCorrect: data.isCorrect,
              reflection: data.reflection,
            },
          ];
          const newDocRef = doc(colRef);
          batch.set(newDocRef, cleanObject(data));
        } else {
          const existingData = existingDoc.data();
          const history = existingData.history || [];

          history.push({
            answer: data.answer,
            submittedAt: data.submittedAt,
            points: data.points,
            isCorrect: data.isCorrect,
            reflection: data.reflection,
          });

          data.history = history;
          batch.update(existingDoc.ref, cleanObject(data));
        }
      }
    }

    await batch.commit();
  },
`;

code = code.replace(/async scoreAndSubmitAnswer\(/, replacement + "\n  async scoreAndSubmitAnswer(");

fs.writeFileSync(filePath, code);
