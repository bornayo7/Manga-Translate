document.querySelectorAll('[data-quiz]').forEach(quiz => {
  const feedback = quiz.querySelector('[role="status"]');
  quiz.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
      const correct = button.dataset.correct === 'true';
      feedback.textContent = button.dataset.feedback;
      feedback.className = correct ? 'good' : '';
      // Local feedback only. No analytics, persistence or learning claim.
    });
  });
});
