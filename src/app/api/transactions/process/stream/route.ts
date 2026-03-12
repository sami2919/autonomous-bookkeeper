import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { streamProcessPendingTransactions } from '@/agents/categorization';
import { generateClarificationMessages } from '@/agents/comms';
import { classifyApiError } from '@/lib/errors';

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const rateLimitError = rateLimit(request);
  if (rateLimitError) return rateLimitError;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of streamProcessPendingTransactions()) {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }

        // Run comms agent after categorization completes and stream its events too
        try {
          const commsResult = await generateClarificationMessages();
          for (const event of commsResult.events) {
            const data = JSON.stringify(event);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        } catch (commsErr) {
          // Don't fail the whole stream if comms agent fails
          const errorEvent = JSON.stringify({
            timestamp: new Date().toISOString(),
            agent: 'comms',
            message: `Comms agent error: ${(commsErr as Error).message}`,
          });
          controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
        }

        // Signal completion
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err) {
        const classified = classifyApiError(err);
        const errorEvent = JSON.stringify({
          timestamp: new Date().toISOString(),
          agent: 'categorization',
          message: `Error: ${classified.message}`,
        });
        controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
