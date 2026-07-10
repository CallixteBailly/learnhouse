import { useAssignments } from '@components/Contexts/Assignments/AssignmentContext';
import { useAssignmentSubmission, useAssignmentTaskSubmissions } from '@components/Contexts/Assignments/AssignmentSubmissionContext';
import { useCourse } from '@components/Contexts/CourseContext';
import { useOrg } from '@components/Contexts/OrgContext';
import { getTaskRefFileDir } from '@services/media/media';
import TaskFileObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskFileObject';
import TaskQuizObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskQuizObject'
import TaskFormObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskFormObject'
import TaskCodeObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskCodeObject'
import TaskShortAnswerObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskShortAnswerObject'
import TaskNumberAnswerObject from 'app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/TaskEditor/Subs/TaskTypes/TaskNumberAnswerObject'
import toast from 'react-hot-toast';
import { Backpack, Calendar, CheckCircle2, Download, EllipsisVertical, Info, MessageSquare, RotateCcw, XCircle } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next';

function AssignmentStudentActivity() {
  const { t } = useTranslation()
  const assignments = useAssignments() as any;
  const _course = useCourse() as any;
  const org = useOrg() as any;
  const submission = useAssignmentSubmission() as any;
  const taskSubmissionsMap = useAssignmentTaskSubmissions() as Record<string, any> | null;

  // Per-task grading is rendered inline only after the whole assignment has
  // been graded — that's when raw task grades are guaranteed to reflect the
  // server-verified value (auto-grade or teacher override). Before that,
  // task.grade is the placeholder 0 from save-progress.
  const isGraded = Array.isArray(submission) && submission.length > 0 && submission[0].submission_status === 'GRADED';

  // Attempt indicator. Only worth showing when the teacher actually enabled
  // retries and the student has burned at least one attempt — otherwise it's
  // noise.
  const allowRetries = !!assignments?.assignment_object?.allow_retries;
  const maxRetries = Number(assignments?.assignment_object?.max_retries || 0);
  const currentAttempt = Number(
    (Array.isArray(submission) && submission[0]?.attempt_number) || 1
  );
  const showAttemptBadge = allowRetries && currentAttempt > 1;

  // Keep per-task pass/fail aligned with the overall grade threshold on the
  // server (50% for NUMERIC / PERCENTAGE / PASS_FAIL, 60% for ALPHABET /
  // GPA_SCALE). Otherwise a student with 55% on a numeric-graded task sees
  // "Not Passed" inline while the same score is "Pass" at the assignment
  // level — exactly the mismatch the teacher tried to avoid.
  const gradingType = assignments?.assignment_object?.grading_type;
  const passingThreshold =
    gradingType === 'ALPHABET' || gradingType === 'GPA_SCALE' ? 60 : 50;

  useEffect(() => {
  }, [assignments, org])


  return (
    <div className='flex flex-col space-y-4 md:space-y-6'>
      <div className='hidden md:flex flex-col md:flex-row justify-center md:space-x-3 space-y-3 md:space-y-0 items-center'>
        <div className='text-xs h-fit flex space-x-3 items-center'>
          <div className='flex gap-2 py-2 px-4 md:px-5 h-fit text-sm text-[var(--ordria-foreground)] bg-[var(--ordria-accent-bg)] rounded-full border border-[var(--ordria-accent-border)] items-center'>
            <Backpack size={14} className="md:size-[14px]" />
            <p className='font-semibold'>{t('activities.assignment')}</p>
          </div>
        </div>
        <div>
          <div className='flex gap-2 items-center flex-wrap justify-center'>
            <EllipsisVertical className='text-slate-400 hidden md:block' size={18} />
            <div className='flex gap-2 items-center'>
              <div className='flex gap-1 md:space-x-2 text-xs items-center text-slate-400'>
                <Calendar size={14} />
                <p className='font-semibold'>{t('assignments.due_date')}</p>
                <p className='font-semibold'>{assignments?.assignment_object?.due_date}</p>
              </div>
            </div>
            {showAttemptBadge && (
              <div className='flex gap-1.5 items-center text-xs px-2.5 py-1 rounded-full bg-fuchsia-50 text-fuchsia-700 font-semibold nice-shadow'>
                <RotateCcw size={12} />
                <span>
                  {maxRetries
                    ? t('assignments.attempt_count_bounded', {
                        current: currentAttempt,
                        max: maxRetries,
                      })
                    : t('assignments.attempt_count', { current: currentAttempt })}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Hearts indicator (decorative) */}
      <div className="hidden md:flex items-center justify-center gap-2 mb-2">
        <span className="text-lg">❤️</span>
        <span className="text-lg">❤️</span>
        <span className="text-lg">❤️</span>
      </div>
      
      {/* Progress bar */}
      {(() => {
        const totalTasks = assignments?.assignment_tasks?.length || 0
        const completedTasks = taskSubmissionsMap ? Object.keys(taskSubmissionsMap).length : 0
        const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
        return totalTasks > 0 ? (
          <div className="mb-6">
            <div className="flex justify-between mb-2">
              <span className="text-sm font-semibold text-[var(--ordria-muted)]">{completedTasks} sur {totalTasks}</span>
              <span className="font-mono text-[var(--ordria-accent-secondary)]">{progressPct}%</span>
            </div>
            <div className="duo-progress-bar">
              <div className="duo-progress-fill" style={{ width: `${progressPct}%` }}></div>
            </div>
          </div>
        ) : null
      })()}
      
      
      
      {assignments?.assignment_object?.description && (
        <div className='hidden md:flex flex-col space-y-2 p-4 md:p-6 bg-[var(--ordria-surface)] rounded-2xl border border-[var(--ordria-border)]'>
          <div className='flex flex-col space-y-3'>
            <div className='flex items-center gap-2 text-slate-700'>
              <Info size={16} className="text-slate-500" />
              <h3 className='text-sm font-semibold'>{t('assignments.assignment_description')}</h3>
            </div>
            <div className='pl-6'>
              <p className='text-sm leading-relaxed text-slate-600'>{assignments.assignment_object.description}</p>
            </div>
          </div>
        </div>
      )}
      
      
      {assignments && assignments?.assignment_tasks?.sort((a: any, b: any) => a.id - b.id).map((task: any, index: number) => {
        const taskSubmission = taskSubmissionsMap ? taskSubmissionsMap[task.assignment_task_uuid] : null;
        const taskGrade = taskSubmission?.grade ?? 0;
        const taskMax = task.max_grade_value || 0;
        const taskFeedback = (taskSubmission?.task_submission_grade_feedback || '').trim();
        const taskPercentage = taskMax > 0 ? Math.round((taskGrade / taskMax) * 100) : 0;
        const taskPassed = taskPercentage >= passingThreshold;

        return (
          <div className='flex flex-col space-y-2' key={task.assignment_task_uuid}>
            <div className='flex flex-col md:flex-row md:justify-between py-2 space-y-2 md:space-y-0'>
              <div className='flex flex-wrap space-x-2 font-semibold text-[var(--ordria-foreground)]' style={{ fontFamily: 'var(--ordria-font-display)' }}>
                <p>{t('assignments.task')} {index + 1} : </p>
                <p className='text-[var(--ordria-muted)] break-words'>{task.description}</p>
              </div>
              <div className='flex flex-wrap gap-2'>
                {task.hint && <div
                  onClick={() => toast(task.hint, { icon: 'ℹ️' })}
                  className='px-3 py-1 flex items-center nice-shadow bg-amber-50/40 text-amber-900 rounded-full space-x-2 cursor-pointer'>
                  <Info size={13} />
                  <p className='text-xs font-semibold'>{t('assignments.hint')}</p>
                </div>}
                {task.reference_file && <Link
                  href={getTaskRefFileDir(
                    org?.org_uuid,
                    assignments?.course_object.course_uuid,
                    assignments?.activity_object.activity_uuid,
                    assignments?.assignment_object.assignment_uuid,
                    task.assignment_task_uuid,
                    task.reference_file
                  )}
                  target='_blank'
                  download={true}
                  className='px-3 py-1 flex items-center nice-shadow bg-cyan-50/40 text-cyan-900 rounded-full space-x-1 md:space-x-2 cursor-pointer'>
                  <Download size={13} />
                  <div className='flex items-center space-x-1 md:space-x-2'>
                    {task.reference_file && (
                      <span className='relative'>
                        <span className='absolute right-0 top-0 block h-2 w-2 rounded-full ring-2 ring-white bg-green-400'></span>
                      </span>
                    )}
                    <p className='text-xs font-semibold'>{t('assignments.reference_document')}</p>
                  </div>
                </Link>}
              </div>
            </div>
            {isGraded && taskSubmission && (
              <div className={`mt-4 p-4 rounded-2xl border-2 ${
                taskPassed
                  ? 'border-[var(--ordria-success)] bg-green-50'
                  : 'border-[var(--ordria-error)] bg-red-50'
              }`}>
                <div className='flex items-center gap-4'>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xl duo-bounce flex-shrink-0 ${
                    taskPassed ? 'bg-[var(--ordria-success)]' : 'bg-[var(--ordria-error)]'
                  }`}>
                    {taskPassed ? '✓' : '✗'}
                  </div>
                  <div className='flex-1'>
                    <p className={`font-bold ${taskPassed ? 'text-[var(--ordria-success)]' : 'text-[var(--ordria-error)]'}`}>
                      {taskPassed ? t('assignments.task_passed', 'Excellent !') : t('assignments.task_not_passed', 'Presque !')}
                    </p>
                    <p className="text-sm text-[var(--ordria-muted)]">
                      {taskGrade}/{taskMax} {t('assignments.score')} · {taskPercentage}%
                    </p>
                  </div>
                </div>
                {taskFeedback && (
                  <div className='mt-3 flex items-start gap-2 p-3 rounded-lg bg-white/70 border border-white'>
                    <MessageSquare size={13} className="shrink-0 mt-0.5 text-slate-400" />
                    <p className='text-xs text-slate-700 leading-relaxed whitespace-pre-wrap'>{taskFeedback}</p>
                  </div>
                )}
              </div>
            )}
            <div className='w-full'>
              {task.assignment_type === 'QUIZ' && <TaskQuizObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'FILE_SUBMISSION' && <TaskFileObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'FORM' && <TaskFormObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'CODE' && <TaskCodeObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'SHORT_ANSWER' && <TaskShortAnswerObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
              {task.assignment_type === 'NUMBER_ANSWER' && <TaskNumberAnswerObject key={task.assignment_task_uuid} view='student' assignmentTaskUUID={task.assignment_task_uuid} />}
            </div>
          </div>
        )
      })}

      {/* Mobile: sticky submit/next button */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 p-3 z-50 md:hidden">
        <button
          className="duo-btn-success w-full"
          onClick={() => {
            const submitBtn = document.querySelector('[class*="bg-cyan-800"]') as HTMLElement
            if (submitBtn) {
              submitBtn.click()
            } else {
              const nextBtn = document.querySelector('[class*="bg-gray-200"]') as HTMLElement
              if (nextBtn) nextBtn.click()
            }
          }}
        >
          {isGraded ? t('common.next', 'Suivant') : t('assignments.submit_for_grading', 'Soumettre')}
        </button>
      </div>
    </div>
  )
}

export default AssignmentStudentActivity
