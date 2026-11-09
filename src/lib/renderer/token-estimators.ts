import type { TokenEstimator } from './chunked-renderer';

/**
 * Simple fast token estimator using character count heuristic
 * ~4 characters per token is standard for most LLMs
 */
export function simpleTokenEstimator(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Create an LLM-based token estimator using llm-cost library
 * This is more accurate but slower due to async overhead
 *
 * @param model - The LLM model to use for estimation (e.g., 'gpt-4o', 'claude-sonnet-4')
 * @returns A token estimator function
 */
export function createLLMTokenEstimator(model: string): TokenEstimator {
  return async (text: string): Promise<number> => {
    try {
      const { tokenizeAndEstimateCost } = await import('llm-cost');
      const { inputTokens } = await tokenizeAndEstimateCost({
        model,
        input: text
      });
      return inputTokens;
    } catch (err) {
      // Fallback to simple estimation if llm-cost fails
      return simpleTokenEstimator(text);
    }
  };
}
