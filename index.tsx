import React, { useState, useEffect, useRef, forwardRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// Declare global variables from CDN scripts on the window object for robust access in modules
declare global {
  interface Window {
    marked: { parse: (markdown: string) => string };
    katex: {
      renderToString(latex: string, options?: { displayMode?: boolean; throwOnError?: boolean }): string;
    };
    jspdf: { jsPDF: new (options?: any) => any };
    html2canvas: (element: HTMLElement, options?: any) => Promise<HTMLCanvasElement>;
  }
}

const SYSTEM_PROMPT = `You are an AI-powered expert in the JEE Main & Advanced Physics syllabus. Your task is to solve and explain physics problems in a structured, exam-oriented manner.
When a user provides a question (as text, an image, or a combination), you must provide a detailed solution that adheres to the following guidelines:

1.  **Difficulty Assessment**: Begin your response by classifying the question's difficulty level, stating either "Difficulty: JEE Main" or "Difficulty: JEE Advanced".
2.  **Step-by-Step Solution**: Present the primary solution in a clear, logical, step-by-step format. Use Markdown for headings, lists, and emphasis to structure the answer.
3.  **LaTeX for Equations**: Render ALL mathematical formulas, variables, and equations using LaTeX. Use \`$$...$$\` for block equations and \`$...$\` for inline equations. This is mandatory.
4.  **Conceptual Insights**: After the main solution, include a section titled "### Conceptual Insights" to explain the underlying physics principles, formulas, and problem-solving strategies.
5.  **Alternate Methods**: If applicable, provide an "### Alternate Method" section demonstrating a different approach to solve the problem.
6.  **Final Answer**: Conclude with a clearly marked "### Final Answer" section. The final numerical or symbolic answer must be enclosed in a Markdown code block for emphasis and clarity.
7.  **Accuracy**: Double-check all calculations, formulas, and conceptual explanations for correctness. Accuracy is paramount.
8.  **Clarity and Conciseness**: Your language should be precise and easy to understand for a student preparing for the JEE exams.`;

// --- Helper Functions ---
const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  const data = await base64EncodedDataPromise;
  return {
    inlineData: {
      data,
      mimeType: file.type,
    },
  };
};

const processSolutionText = (text: string): string => {
  if (typeof window.marked === 'undefined' || typeof window.katex === 'undefined') {
    return text; // Return raw text if libraries are not loaded
  }
  // Replace LaTeX blocks ($$...$$) with KaTeX rendered HTML
  let processedText = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, latex) => {
    try {
      return window.katex.renderToString(latex, { displayMode: true, throwOnError: false });
    } catch (e) {
      console.error('KaTeX block error:', e);
      return match;
    }
  });

  // Replace inline LaTeX ($...$) with KaTeX rendered HTML
  processedText = processedText.replace(/(?<!\$)\$([^$]+?)\$/g, (match, latex) => {
    try {
      return window.katex.renderToString(latex, { displayMode: false, throwOnError: false });
    } catch (e) {
      console.error('KaTeX inline error:', e);
      return match;
    }
  });

  return window.marked.parse(processedText);
};

// --- React Components ---
const SolutionDisplay = forwardRef<HTMLDivElement, { markdownText: string }>(({ markdownText }, ref) => {
  const [html, setHtml] = useState('');

  useEffect(() => {
    setHtml(processSolutionText(markdownText));
  }, [markdownText]);

  return <div ref={ref} className="solution-content" dangerouslySetInnerHTML={{ __html: html }} />;
});


const App: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [solution, setSolution] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSavingPdf, setIsSavingPdf] = useState(false);
  const [error, setError] = useState('');
  
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const solutionRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt && !imageFile) {
      setError('Please enter a question or upload an image.');
      return;
    }
    setError('');
    setSolution('');
    setLoading(true);

    try {
      const contents: any[] = [];
      if (prompt) {
        contents.push({ text: prompt });
      }
      if (imageFile) {
        const imagePart = await fileToGenerativePart(imageFile);
        contents.push(imagePart);
      }
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: contents },
        config: {
          systemInstruction: SYSTEM_PROMPT,
        }
      });
      
      setSolution(response.text);

    } catch (err: any) {
      console.error(err);
      setError(`Failed to generate solution. ${err.message || 'Please try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(solution)
      .then(() => alert('Solution copied to clipboard!'))
      .catch(err => alert('Failed to copy text.'));
  };

  const handleSaveAsPdf = async () => {
    if (!solutionRef.current || typeof window.jspdf === 'undefined' || typeof window.html2canvas === 'undefined') {
        alert('Could not save PDF. Required libraries not loaded or solution not present.');
        return;
    }
    setIsSavingPdf(true);
    try {
        const element = solutionRef.current;
        const canvas = await window.html2canvas(element, { scale: 2, useCORS: true });
        
        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;
        
        const ratio = canvasWidth / pdfWidth;
        const imgHeight = canvasHeight / ratio;
        const pdfHeight = pdf.internal.pageSize.getHeight();
        
        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pdfHeight;

        while (heightLeft > 0) {
            position = heightLeft - imgHeight; // Negative position
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
            heightLeft -= pdfHeight;
        }

        pdf.save('jee-physics-solution.pdf');
    } catch (err) {
        console.error('Failed to create PDF:', err);
        setError('An error occurred while creating the PDF.');
    } finally {
        setIsSavingPdf(false);
    }
  };


  return (
    <div className="app-container">
      <header className="app-header">
        <h1>JEE Physics AI Tutor</h1>
        <p>Your expert guide for JEE Main & Advanced physics problems.</p>
      </header>
      <main className="main-content">
        <section className="input-section">
          <h2>Ask a Question</h2>
          <form onSubmit={handleSubmit} className="input-form">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Type your physics question here, or describe the image you're uploading..."
              aria-label="Physics Question Input"
            />
            <div className="file-input-wrapper">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="file-button">
                Upload Image
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => setImageFile(e.target.files ? e.target.files[0] : null)}
                accept="image/png, image/jpeg, image/webp"
                style={{ display: 'none' }}
                aria-label="Upload an image of the problem"
              />
              {imageFile && <span className="file-name">{imageFile.name}</span>}
            </div>
            <button type="submit" disabled={loading} className="solve-button">
              {loading ? <div className="spinner" /> : 'Solve'}
            </button>
          </form>
        </section>

        <section className="output-section" aria-live="polite">
          <h2>Solution</h2>
          <div className="solution-card">
            {loading && <div className="loading-state">Generating solution...</div>}
            {error && <div className="error-state">{error}</div>}
            {!loading && !error && !solution && (
              <div className="placeholder-state">
                Your detailed, step-by-step solution will appear here.
              </div>
            )}
            {solution && (
              <>
                <div className="solution-actions">
                  <button onClick={handleCopy}>Copy Markdown</button>
                  <button onClick={handleSaveAsPdf} disabled={isSavingPdf}>
                    {isSavingPdf ? 'Saving...' : 'Save as PDF'}
                  </button>
                </div>
                <SolutionDisplay ref={solutionRef} markdownText={solution} />
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);