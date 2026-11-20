export const createConsentService = ({ repository }) => ({
  policy: (actor) => repository.consent(actor, 'policy'),
  accept: (actor, data) => repository.consent(actor, 'accept', data),
  status: (actor, employeeId) => repository.consent(actor, 'status', { employeeId }),
  updatePolicy: (actor, data) => repository.consent(actor, 'update', data),
});
