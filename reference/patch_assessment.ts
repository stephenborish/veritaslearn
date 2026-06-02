import fs from 'fs';

const filePath = 'src/components/student/AssessmentDelivery.tsx';
let code = fs.readFileSync(filePath, 'utf8');

const search = `        const promises = pendingKeys.map(async (k) => {
          const item = queue[k];
          item.status = "saving";
          const q = questions.find((q) => q.id === k);
          if (q) {
            await dbService.scoreAndSubmitAnswer(
              id,
              student.studentId,
              student.studentName,
              q,
              item.answer,
              item.reflection,
            );
          }
          return { k, item };
        });

        const results = await Promise.allSettled(promises);
        let hasErrors = false;

        for (const result of results) {
          if (result.status === "fulfilled") {
            const { k, item } = result.value;
            if (writeQueueRef.current[k] === item) {
              delete writeQueueRef.current[k];
            }
            madeProgress = true;
          } else {
            console.error(\`Failed to save response\`, result.reason);
            // Re-mark as failed since we don't have the key easily from a rejected promise if it failed inside
            // However, we can just let it stay 'saving' or 'failed', it will be picked up again
            hasErrors = true;
          }
        }

        if (hasErrors) {
          // Find anything stuck in saving and mark failed
          Object.values(writeQueueRef.current).forEach((v) => {
            if (v.status === "saving") v.status = "failed";
          });
          break;
        }`;

const replace = `        const batchItems: { q: any; answer: any; reflection?: any }[] = [];
        const processedKeys: string[] = [];

        for (const k of pendingKeys) {
          const item = queue[k];
          item.status = "saving";
          const q = questions.find((q) => q.id === k);
          if (q) {
            batchItems.push({ q, answer: item.answer, reflection: item.reflection });
            processedKeys.push(k);
          } else {
             processedKeys.push(k);
          }
        }

        let hasErrors = false;
        try {
          if (batchItems.length > 0) {
            await dbService.scoreAndSubmitAnswersBatch(
              id,
              student.studentId,
              student.studentName,
              batchItems
            );
          }

          for (const k of processedKeys) {
            if (writeQueueRef.current[k] && writeQueueRef.current[k].status === "saving") {
               delete writeQueueRef.current[k];
            }
          }
          madeProgress = processedKeys.length > 0;

        } catch (error) {
          console.error("Failed to save responses in batch", error);
          hasErrors = true;
        }

        if (hasErrors) {
          Object.values(writeQueueRef.current).forEach((v) => {
            if (v.status === "saving") v.status = "failed";
          });
          break;
        }`;

// Replace carefully by matching up to the exact whitespace using regex if standard replace fails.
const regex = /const promises = pendingKeys\.map\(async \(\k\) => \{[\s\S]*?break;\n\s*\}/;

if (regex.test(code)) {
    code = code.replace(regex, replace);
    fs.writeFileSync(filePath, code);
    console.log("Replaced successfully with regex.");
} else {
    console.log("Regex not found.");
}
