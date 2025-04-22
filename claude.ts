// claude.ts - Handles communication with the backend server

// Define the expected structure for analysis results
export interface AnalysisResult {
  heuristic: string;
  issue: string;
  suggestion: string;
}

// Define the structure for component data (adjust as needed)
export interface ComponentData {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  childrenCount: number;
  // Add more relevant properties: text content, colors, layout props, etc.
}

const SERVER_URL = 'http://localhost:3000/analyze'; // Your server URL

export async function analyzeComponentWithClaude(componentData: ComponentData, principles: string): Promise<AnalysisResult[]> {
  console.log('Sending data to server:', { componentData, principles });
  try {
    const response = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ componentData, principles }),
    });

    if (!response.ok) {
      // Attempt to read the error message from the server response
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        // If the response isn't JSON, use the status text
        errorData = { error: response.statusText };
      }
      console.error('Server returned an error:', response.status, errorData);
      throw new Error(`Server error: ${errorData.error || response.statusText}`);
    }

    const results: AnalysisResult[] = await response.json();
    console.log('Received analysis results from server:', results);
    return results;
  } catch (error) {
    console.error('Error calling backend server:', error);
    let errorMessage = 'An unknown error occurred';
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    // Rethrow or handle the error appropriately for the plugin UI
    figma.notify(`Error analyzing component: ${errorMessage}`, { error: true });
    throw error; // Rethrow to be caught by the calling function in code.ts if needed
  }
} 