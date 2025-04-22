require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const port = process.env.PORT || 3000; // Allow configuring port via .env

// --- Anthropic Setup ---
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY is not set in the .env file.');
  // Optionally exit or handle this case appropriately
  // process.exit(1);
}

// --- Middleware ---
app.use(cors()); // Enable CORS for requests from the Figma plugin
app.use(express.json()); // Parse JSON request bodies

// --- Routes ---
app.post('/analyze', async (req, res) => {
  const { componentData, principles } = req.body;

  if (!componentData || !principles) {
    return res.status(400).json({ error: 'Missing componentData or principles in request body' });
  }

  if (!anthropic.apiKey) {
     return res.status(500).json({ error: 'Anthropic API key not configured on server.' });
  }

  try {
    // Construct the prompt for Claude
    const systemPrompt = `You are a UX analysis expert specializing in Nielsen Norman Group's heuristics and visual design principles. You will analyze Figma UI components based on their properties and structure.

The component data you'll receive is a Figma mockup that we need to review. It includes:
- Basic properties: width, height, type, name
- Layout information: layoutMode (AUTO_LAYOUT or NONE), padding, itemSpacing
- Children elements with their properties:
  * Position (x, y)
  * Dimensions (width, height)
  * Text content and styling (for text elements)
  * Visual properties (fills, strokes, opacity)
  * Visibility state
  * Hierarchy and nesting

When analyzing, consider:
1. Visual Hierarchy:
   - Size relationships between elements
   - Spacing and positioning
   - Text hierarchy (if present)
   - Use of color and contrast

2. Layout Principles:
   - Proximity between related elements
   - Alignment and distribution
   - Use of padding and margins
   - Responsive behavior (based on AUTO_LAYOUT)

3. Typography (for text elements):
   - Font size appropriateness
   - Text readability
   - Heading vs body text distinction

4. Interactive Elements:
   - Visibility of clickable areas
   - Spacing for touch targets
   - State indicators

5. Accessibility:
   - Color contrast
   - Text size legibility
   - Element spacing for usability

Based on the principles:\n${principles}\n

Analyze the component ignoring hidden layersand provide specific, actionable feedback. Focus on concrete issues in the provided component, not generic advice.

Respond ONLY with a JSON array of objects, where each object has:
- 'heuristic': The specific principle being violated
- 'issue': The exact problem found in this component and the layer name only.
- 'suggestion': A specific, implementable solution

Example: [
  {
    "heuristic": "Visual Hierarchy - Text Contrast",
    "issue": "The text element at (x: 24, y: 45) uses a light gray (#CCCCCC) on white background, making it hard to read",
    "suggestion": "Increase the contrast by using a darker gray (at least #666666) for this specific text element"
  }
]`;

    const userMessage = `Analyze this component:\n\n${JSON.stringify(componentData, null, 2)}`;

    console.log("--- Sending Prompt to Claude ---");
    console.log("System Prompt:", systemPrompt);
    console.log("User Message:", userMessage);
    console.log("-------------------------------");

    const msg = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307', // Or Opus/Sonnet, configurable via .env
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    console.log("--- Received Response from Claude ---");
    let responseContent = msg.content[0].text;
    console.log("Raw Response Text:", responseContent);

    // Remove any markdown code blocks if present
    responseContent = responseContent.replace(/```json\n|\n```$|```\n|\n```/g, '');
    
    // Try to find a valid JSON array in the response
    const jsonMatch = responseContent.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No valid JSON array found in response');
    }

    try {
      const analysisResults = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(analysisResults)) {
        throw new Error('Response is not an array');
      }
      
      // Validate each result object has required fields
      const validResults = analysisResults.filter(result => 
        result && 
        typeof result === 'object' &&
        'heuristic' in result &&
        'issue' in result &&
        'suggestion' in result
      );

      if (validResults.length === 0) {
        throw new Error('No valid analysis results found');
      }

      console.log("Parsed JSON Results:", validResults);
      res.json(validResults);
    } catch (parseError) {
      console.error('Error parsing Claude response:', parseError);
      console.error('Claude Raw Response was:', responseContent);
      res.status(500).json({ 
        error: 'Failed to parse analysis results from AI.',
        details: parseError.message,
        rawResponse: responseContent
      });
    }

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Failed to get analysis from AI', 
      details: error.message 
    });
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`EVA server listening on port ${port}`);
  if (!process.env.ANTHROPIC_API_KEY) {
     console.warn('Warning: ANTHROPIC_API_KEY is missing. The /analyze endpoint will fail.');
  }
}); 