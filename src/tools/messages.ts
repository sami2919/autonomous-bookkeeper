// Message tools — customer communication for flagged transactions.

import { tool } from 'ai';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '@/lib/accounting';
import { customerMessages, transactions } from '@/db/schema';

type MessageRow = {
  id: number;
  transactionId: number;
  direction: 'agent' | 'customer';
  content: string;
  createdAt: string;
};

export function createMessageTools(db: Db) {
  const sendMessage = tool({
    description:
      'Send a message to the customer about a specific transaction. ' +
      'Use this after flagging a transaction with flagForClarification to ask for more context. ' +
      'Messages are stored with direction="agent" and associated with the transaction. ' +
      'The transaction must exist in the database.',
    inputSchema: z.object({
      transactionId: z
        .number()
        .int()
        .positive()
        .describe(
          'The database ID of the transaction this message is about. ' +
            'The transaction should have status "needs_clarification".'
        ),
      content: z
        .string()
        .min(1)
        .describe(
          'The message content to send to the customer. ' +
            'Be specific about which transaction you are asking about and what information you need.'
        ),
    }),
    execute: async ({ transactionId, content }) => {
      try {
        const transaction = db
          .select({ id: transactions.id, status: transactions.status })
          .from(transactions)
          .where(eq(transactions.id, transactionId))
          .get();

        if (!transaction) {
          return {
            success: false,
            error: `Transaction ${transactionId} not found. Cannot send message for a non-existent transaction.`,
          };
        }

        if (transaction.status !== 'needs_clarification') {
          return {
            success: false,
            error:
              `Transaction ${transactionId} has status '${transaction.status}'. ` +
              `Messages can only be sent for transactions with status 'needs_clarification'. ` +
              `Use flagForClarification first.`,
          };
        }

        const inserted = db
          .insert(customerMessages)
          .values({
            transactionId,
            direction: 'agent',
            content,
          })
          .returning()
          .get() as MessageRow;

        return { success: true, message: inserted };
      } catch (error) {
        return {
          success: false,
          error: `Failed to send message for transaction ${transactionId}: ${(error as Error).message}`,
        };
      }
    },
  });

  const getConversation = tool({
    description:
      'Retrieve the full conversation history for a transaction — all agent and customer messages. ' +
      'Messages are ordered chronologically (oldest first). ' +
      'Use this before sending a new message to understand the conversation context ' +
      'and avoid repeating questions already asked.',
    inputSchema: z.object({
      transactionId: z
        .number()
        .int()
        .positive()
        .describe('The database ID of the transaction whose conversation to retrieve'),
    }),
    execute: async ({ transactionId }) => {
      try {
        const transaction = db
          .select({ id: transactions.id, status: transactions.status })
          .from(transactions)
          .where(eq(transactions.id, transactionId))
          .get();

        if (!transaction) {
          return {
            success: false,
            messages: [] as MessageRow[],
            count: 0,
            error: `Transaction ${transactionId} not found`,
          };
        }

        const messages = db
          .select()
          .from(customerMessages)
          .where(eq(customerMessages.transactionId, transactionId))
          .orderBy(asc(customerMessages.createdAt))
          .all() as MessageRow[];

        return {
          success: true,
          transactionStatus: transaction.status,
          messages,
          count: messages.length,
        };
      } catch (error) {
        return {
          success: false,
          messages: [] as MessageRow[],
          count: 0,
          error: `Failed to fetch conversation for transaction ${transactionId}: ${(error as Error).message}`,
        };
      }
    },
  });

  return { sendMessage, getConversation };
}

export type MessageTools = ReturnType<typeof createMessageTools>;
